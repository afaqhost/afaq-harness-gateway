"""Job manager for harness install/update — in-memory with Redis fallback for multi-replica.

Keeps in-memory dict as primary (fast, no network), but also mirrors to Redis
when `REDIS_URL` is configured so `GET /jobs/{id}` works cross-pod.
"""

from __future__ import annotations

import asyncio
import logging
import json
import time
import uuid
from dataclasses import dataclass, field

from app.clients.base import HarnessAdapter

logger = logging.getLogger("afaq")


@dataclass
class HarnessJob:
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    harness: str = ""
    stage: str = "pending"  # pending|running|completed|failed
    logs: list[str] = field(default_factory=list)
    exit_code: int | None = None
    created_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "harness": self.harness,
            "stage": self.stage,
            "logs": list(self.logs),
            "exit_code": self.exit_code,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _get_redis():
    try:
        from app.core.config import get_settings

        s = get_settings()
        if not s.redis_enabled or not s.redis_url:
            return None
        import redis as sync_redis  # type: ignore

        client = sync_redis.from_url(s.redis_url, decode_responses=True)
        client.ping()
        return client
    except (ImportError, OSError, RuntimeError) as exc:
        logger.warning("redis_unavailable_fallback error=%s", exc)
        return None


def _job_key(job_id: str) -> str:
    return f"job:{job_id}"


def _job_to_json(job: HarnessJob) -> str:
    return json.dumps(job.to_dict())


def _json_to_job(data: str) -> HarnessJob | None:
    try:
        d = json.loads(data)
        return HarnessJob(
            id=d.get("id", ""),
            harness=d.get("harness", ""),
            stage=d.get("stage", "pending"),
            logs=list(d.get("logs", [])),
            exit_code=d.get("exit_code"),
            created_at=float(d.get("created_at", time.monotonic())),
            updated_at=float(d.get("updated_at", time.monotonic())),
        )
    except (ImportError, OSError, RuntimeError) as exc:
        logger.warning("redis_unavailable_fallback error=%s", exc)
        return None


class HarnessJobService:
    def __init__(self, max_logs: int = 500, ttl_seconds: int = 3600):
        self._jobs: dict[str, HarnessJob] = {}
        self._lock = asyncio.Lock()
        self._max_logs = max_logs
        self._ttl = ttl_seconds

    def _redis_sync(self, job: HarnessJob) -> None:
        try:
            rc = _get_redis()
            if rc:
                rc.set(_job_key(job.id), _job_to_json(job), ex=self._ttl)
        except (OSError, RuntimeError) as exc:
            logger.warning("job_sync_best_effort_failed error=%s", exc)

    def _redis_delete(self, job_id: str) -> None:
        try:
            rc = _get_redis()
            if rc:
                rc.delete(_job_key(job_id))
        except (OSError, RuntimeError) as exc:
            logger.warning("job_sync_best_effort_failed error=%s", exc)

    async def _run_adapter(self, job: HarnessJob, adapter: HarnessAdapter, mode: str):
        # mode: install or update
        try:
            job.stage = "running"
            job.updated_at = time.monotonic()
            self._redis_sync(job)
            gen = adapter.install() if mode == "install" else adapter.update()
            async for event in gen:
                msg = event.get("message", "")
                stage = event.get("stage", "running")
                # cap logs
                if msg:
                    if len(job.logs) >= self._max_logs:
                        job.logs.pop(0)
                    job.logs.append(msg)
                if stage in ("completed", "failed", "error"):
                    job.stage = "completed" if stage == "completed" or event.get("exit_code") == 0 else "failed"
                    job.exit_code = event.get("exit_code")
                else:
                    job.stage = stage
                job.updated_at = time.monotonic()
                self._redis_sync(job)
                # small yield to allow streaming
                await asyncio.sleep(0)
            # if not already completed/failed, mark completed
            if job.stage not in ("completed", "failed"):
                job.stage = "completed" if job.exit_code in (None, 0) else "failed"
            job.updated_at = time.monotonic()
            self._redis_sync(job)
        except (OSError, RuntimeError, asyncio.TimeoutError) as e:
            job.stage = "failed"
            job.exit_code = 1
            if len(job.logs) < self._max_logs:
                job.logs.append(f"error: {e}")
            job.updated_at = time.monotonic()
            self._redis_sync(job)
        # schedule cleanup after TTL (fire and forget)
        asyncio.create_task(self._expire_job(job.id))

    async def _expire_job(self, job_id: str):
        await asyncio.sleep(self._ttl)
        async with self._lock:
            self._jobs.pop(job_id, None)
        self._redis_delete(job_id)

    async def start_install(self, adapter: HarnessAdapter) -> HarnessJob:
        job = HarnessJob(harness=adapter.name, stage="pending")
        async with self._lock:
            self._jobs[job.id] = job
        self._redis_sync(job)
        # run in background
        asyncio.create_task(self._run_adapter(job, adapter, "install"))
        return job

    async def start_update(self, adapter: HarnessAdapter) -> HarnessJob:
        job = HarnessJob(harness=adapter.name, stage="pending")
        async with self._lock:
            self._jobs[job.id] = job
        self._redis_sync(job)
        asyncio.create_task(self._run_adapter(job, adapter, "update"))
        return job

    async def get(self, job_id: str) -> HarnessJob | None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job:
                return job
        # fallback to Redis for cross-pod reads
        try:
            rc = _get_redis()
            if rc:
                raw = rc.get(_job_key(job_id))
                if raw:
                    return _json_to_job(raw)
        except (OSError, RuntimeError) as exc:
            logger.warning("job_sync_best_effort_failed error=%s", exc)
        return None

    def list_for_harness(self, harness: str) -> list[HarnessJob]:
        # sync, for simplicity (no lock needed for read? Use lock)
        # we return copy
        return [j for j in self._jobs.values() if j.harness == harness]

    async def clear(self):
        async with self._lock:
            self._jobs.clear()


# singleton
harness_job_service = HarnessJobService()

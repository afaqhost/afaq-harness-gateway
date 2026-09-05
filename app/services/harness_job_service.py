"""Job manager for harness install/update — in-memory with logs."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from app.clients.base import HarnessAdapter


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


class HarnessJobService:
    def __init__(self, max_logs: int = 500, ttl_seconds: int = 3600):
        self._jobs: dict[str, HarnessJob] = {}
        self._lock = asyncio.Lock()
        self._max_logs = max_logs
        self._ttl = ttl_seconds

    async def _run_adapter(self, job: HarnessJob, adapter: HarnessAdapter, mode: str):
        # mode: install or update
        try:
            job.stage = "running"
            job.updated_at = time.monotonic()
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
                # small yield to allow streaming
                await asyncio.sleep(0)
            # if not already completed/failed, mark completed
            if job.stage not in ("completed", "failed"):
                job.stage = "completed" if job.exit_code in (None, 0) else "failed"
            job.updated_at = time.monotonic()
        except Exception as e:
            job.stage = "failed"
            job.exit_code = 1
            if len(job.logs) < self._max_logs:
                job.logs.append(f"error: {e}")
            job.updated_at = time.monotonic()
        # schedule cleanup after TTL (fire and forget)
        asyncio.create_task(self._expire_job(job.id))

    async def _expire_job(self, job_id: str):
        await asyncio.sleep(self._ttl)
        async with self._lock:
            self._jobs.pop(job_id, None)

    async def start_install(self, adapter: HarnessAdapter) -> HarnessJob:
        job = HarnessJob(harness=adapter.name, stage="pending")
        async with self._lock:
            self._jobs[job.id] = job
        # run in background
        asyncio.create_task(self._run_adapter(job, adapter, "install"))
        return job

    async def start_update(self, adapter: HarnessAdapter) -> HarnessJob:
        job = HarnessJob(harness=adapter.name, stage="pending")
        async with self._lock:
            self._jobs[job.id] = job
        asyncio.create_task(self._run_adapter(job, adapter, "update"))
        return job

    async def get(self, job_id: str) -> HarnessJob | None:
        async with self._lock:
            return self._jobs.get(job_id)

    def list_for_harness(self, harness: str) -> list[HarnessJob]:
        # sync, for simplicity (no lock needed for read? Use lock)
        # we return copy
        return [j for j in self._jobs.values() if j.harness == harness]

    async def clear(self):
        async with self._lock:
            self._jobs.clear()


# singleton
harness_job_service = HarnessJobService()

"""Outbound adapter contract — hides external harness CLI details behind an interface.

This module is the Client boundary (you call the outside world). Business
logic lives in services/ and depends on this abstraction, never on the
concrete CLI.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import time
from abc import ABC, abstractmethod
from typing import AsyncIterator

from app.core.config import settings
from app.models.harness import HarnessModel, HarnessResult


class HarnessAdapter(ABC):
    name: str = "custom"
    display_name: str = "Custom Harness"
    executable: str = ""
    provider: str = ""
    install_command: list[str] = []
    update_command: list[str] = []

    def is_installed(self) -> bool:
        return shutil.which(self.executable) is not None

    async def install(self) -> AsyncIterator[dict]:
        if not self.install_command:
            yield {"stage": "error", "message": "No install recipe configured"}
            return
        yield {"stage": "started", "message": "Installing harness"}
        process = await asyncio.create_subprocess_exec(
            *self.install_command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        assert process.stdout
        async for line in process.stdout:
            yield {"stage": "running", "message": line.decode(errors="replace").rstrip()}
        code = await process.wait()
        yield {"stage": "completed" if code == 0 else "failed", "exit_code": code}

    async def update(self) -> AsyncIterator[dict]:
        if not self.update_command:
            yield {"stage": "error", "message": "No update recipe configured"}
            return
        process = await asyncio.create_subprocess_exec(
            *self.update_command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
        assert process.stdout
        async for line in process.stdout:
            yield {"stage": "running", "message": line.decode(errors="replace").rstrip()}
        yield {"stage": "completed" if await process.wait() == 0 else "failed"}

    async def authenticate(self, mode: str = "environment") -> dict:
        return {
            "mode": mode,
            "status": "manual_required",
            "message": "Use the harness official login flow or environment variables.",
        }

    async def list_models(self) -> list[HarnessModel]:
        return []

    @abstractmethod
    def build_command(self, prompt: str, model: str | None = None, session_id: str | None = None) -> list[str]: ...

    def parse_line(self, line: str, model: str) -> tuple[str, dict]:
        return line, {}

    def parse_output(self, output: bytes, model: str) -> str:
        return output.decode(errors="replace").strip()

    async def run(
        self, prompt: str, model: str | None = None, session_id: str | None = None, env: dict | None = None, request_id: str | None = None
    ) -> HarnessResult:
        model = model or "default"
        command = self.build_command(prompt, model, session_id)
        started = time.monotonic()
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, **(env or {})},
        )
        # register for cancel if request_id provided
        if request_id:
            try:
                from app.services.process_registry import ProcessHandle, process_registry

                await process_registry.register(
                    request_id,
                    ProcessHandle(
                        pid=process.pid or 0,
                        process=process,
                        harness=self.name,
                        model=model,
                        request_id=request_id,
                    ),
                )
            except Exception:
                pass
        run_timeout = min(settings.harness_timeout_seconds, 90)
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=run_timeout)
        except asyncio.TimeoutError:
            try:
                process.kill()
                await process.wait()
            except ProcessLookupError:
                pass
            raise RuntimeError(
                f"{self.name} timed out after {run_timeout}s — model '{model}' may be unavailable or harness hung. "
                "Try a different model (e.g. opencode/big-pickle)."
            )
        finally:
            if request_id:
                try:
                    from app.services.process_registry import process_registry

                    await process_registry.cleanup(request_id)
                except Exception:
                    pass
        if process.returncode != 0:
            error = stderr.decode(errors="replace").strip() or stdout.decode(errors="replace").strip()
            if "ollama" in error.lower() or "model" in error.lower() and "not found" in error.lower():
                error = f"{error} — تأكد أن الموديل متاح. جرب opencode/big-pickle"
            raise RuntimeError(f"{self.name} failed ({process.returncode}): {error}")
        text = self.parse_output(stdout, model)
        if not text:
            serr = stderr.decode(errors="replace").strip()
            if serr:
                raise RuntimeError(f"{self.name} returned empty response (stderr: {serr[:500]})")
        return HarnessResult(
            text=text,
            model=model,
            raw={"stderr": stderr.decode(errors="replace"), "latency_ms": int((time.monotonic() - started) * 1000)},
        )

    async def stream(
        self, prompt: str, model: str | None = None, session_id: str | None = None, env: dict | None = None, request_id: str | None = None
    ) -> AsyncIterator[tuple[str, dict]]:
        model = model or "default"
        command = self.build_command(prompt, model, session_id)
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, **(env or {})},
        )
        assert process.stdout
        assert process.stderr
        cur_timeout = min(settings.harness_timeout_seconds, 90)
        if request_id:
            try:
                from app.services.process_registry import ProcessHandle, process_registry

                await process_registry.register(
                    request_id,
                    ProcessHandle(
                        pid=process.pid or 0,
                        process=process,
                        harness=self.name,
                        model=model,
                        request_id=request_id,
                    ),
                )
            except Exception:
                pass
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(process.stdout.readline(), timeout=cur_timeout)
                except asyncio.TimeoutError:
                    try:
                        process.kill()
                        await process.wait()
                    except ProcessLookupError:
                        pass
                    raise RuntimeError(
                        f"{self.name} stream timed out after {cur_timeout}s — الموديل '{model}' لا يرد. "
                        "جرب opencode/big-pickle أو تأكد من تثبيت الموديل."
                    )
                if not raw:
                    break
                line = raw.decode(errors="replace")
                if not line.strip():
                    continue
                text, metadata = self.parse_line(line, model)
                if text:
                    yield text, metadata
            try:
                code = await asyncio.wait_for(process.wait(), timeout=5)
            except asyncio.TimeoutError:
                try:
                    process.kill()
                    await process.wait()
                except ProcessLookupError:
                    pass
                raise RuntimeError(f"{self.name} did not exit cleanly after stream")
            if code != 0:
                try:
                    err_bytes = await asyncio.wait_for(process.stderr.read(), timeout=2)
                    error = err_bytes.decode(errors="replace").strip()
                except asyncio.TimeoutError:
                    error = ""
                if not error:
                    error = f"exit code {code}"
                raise RuntimeError(f"{self.name} failed ({code}): {error}")
        finally:
            if request_id:
                try:
                    from app.services.process_registry import process_registry

                    await process_registry.cleanup(request_id)
                except Exception:
                    pass
            if process.returncode is None:
                try:
                    process.kill()
                    await process.wait()
                except ProcessLookupError:
                    pass

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


class ProjectUpdateError(RuntimeError):
    pass


class ProjectUpdateUnavailableError(ProjectUpdateError):
    pass


class ProjectUpdateConflictError(ProjectUpdateError):
    pass


class ProjectUpdateFailedError(ProjectUpdateError):
    pass


@dataclass(frozen=True)
class ProjectUpdateResult:
    updated: bool
    branch: str
    commit: str


@dataclass(frozen=True)
class CommandResult:
    exit_code: int
    output: str


class ProjectUpdateService:
    _OUTPUT_LIMIT = 64 * 1024

    def __init__(self, repository_path: Path, repository_slug: str, timeout_seconds: int):
        self._repository_path = repository_path
        self._repository_slug = repository_slug
        self._timeout_seconds = timeout_seconds
        self._lock = asyncio.Lock()

    async def pull_latest(self) -> ProjectUpdateResult:
        if self._lock.locked():
            raise ProjectUpdateConflictError("A project update is already running")
        async with self._lock:
            self._require_repository()
            await self._require_trusted_origin()
            await self._require_clean_worktree()
            branch = await self._current_branch()
            before = await self._current_commit()
            pull = await self._run_git("pull", "--ff-only", "--", "origin", branch, timeout=self._timeout_seconds)
            if pull.exit_code != 0:
                raise ProjectUpdateFailedError("Git could not fast-forward the project")
            after = await self._current_commit()
            return ProjectUpdateResult(updated=before != after, branch=branch, commit=after[:12])

    def _require_repository(self) -> None:
        if not (self._repository_path / ".git").exists():
            raise ProjectUpdateUnavailableError("This installation is not a Git checkout")

    async def _require_trusted_origin(self) -> None:
        remote = await self._run_git("config", "--get", "remote.origin.url")
        if remote.exit_code != 0 or _github_repository_slug(remote.output) != self._repository_slug.lower():
            raise ProjectUpdateUnavailableError("The Git origin does not match the configured repository")

    async def _require_clean_worktree(self) -> None:
        # Untracked files do not change the checked-out revision and are safe to
        # leave in place. Git itself will still refuse a pull if an incoming
        # tracked path would overwrite one of them.
        status = await self._run_git("status", "--porcelain", "--untracked-files=no")
        if status.exit_code != 0:
            raise ProjectUpdateUnavailableError("Git could not inspect the project worktree")
        if status.output.strip():
            raise ProjectUpdateConflictError("The project has local changes; commit or move them before updating")

    async def _current_branch(self) -> str:
        branch = await self._run_git("symbolic-ref", "--quiet", "--short", "HEAD")
        if branch.exit_code != 0 or not branch.output.strip():
            raise ProjectUpdateConflictError("The project is not on a branch")
        return branch.output.strip()

    async def _current_commit(self) -> str:
        commit = await self._run_git("rev-parse", "HEAD")
        if commit.exit_code != 0 or not commit.output.strip():
            raise ProjectUpdateUnavailableError("Git could not read the current revision")
        return commit.output.strip()

    async def _run_git(self, *arguments: str, timeout: int = 15) -> CommandResult:
        environment = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        environment.setdefault("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
        try:
            process = await asyncio.create_subprocess_exec(
                "git",
                *arguments,
                cwd=self._repository_path,
                env=environment,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except OSError as exc:
            raise ProjectUpdateUnavailableError("Git is not available") from exc
        return await self._collect_process(process, timeout)

    async def _collect_process(self, process: asyncio.subprocess.Process, timeout: int) -> CommandResult:
        try:
            return await asyncio.wait_for(self._wait_for_process(process), timeout=timeout)
        except asyncio.TimeoutError as exc:
            await _terminate_process(process)
            raise ProjectUpdateFailedError("Git update timed out") from exc
        except asyncio.CancelledError:
            await _terminate_process(process)
            raise

    async def _wait_for_process(self, process: asyncio.subprocess.Process) -> CommandResult:
        output = await self._read_output(process)
        exit_code = await process.wait()
        return CommandResult(exit_code=exit_code, output=output.decode("utf-8", errors="replace").strip())

    async def _read_output(self, process: asyncio.subprocess.Process) -> bytes:
        if process.stdout is None:
            return b""
        output = bytearray()
        while chunk := await process.stdout.read(4096):
            output.extend(chunk)
            if len(output) > self._OUTPUT_LIMIT:
                await _terminate_process(process)
                raise ProjectUpdateFailedError("Git produced too much output")
        return bytes(output)


async def _terminate_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        try:
            process.kill()
        except ProcessLookupError:
            pass
    await process.wait()


def _github_repository_slug(remote_url: str) -> str | None:
    normalized = remote_url.strip().removesuffix(".git").rstrip("/")
    if normalized.startswith("git@github.com:"):
        return normalized.split(":", 1)[1].lower()
    parsed = urlparse(normalized)
    if parsed.hostname != "github.com":
        return None
    return parsed.path.strip("/").lower()

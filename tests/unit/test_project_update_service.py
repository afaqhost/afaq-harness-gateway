import subprocess
from pathlib import Path

import pytest

from app.services.project_update_service import (
    ProjectUpdateConflictError,
    ProjectUpdateService,
    ProjectUpdateUnavailableError,
)


def run_git(repository: Path, *arguments: str) -> str:
    completed = subprocess.run(
        ["git", *arguments], cwd=repository, check=True, capture_output=True, text=True
    )
    return completed.stdout.strip()


@pytest.fixture
def git_checkouts(tmp_path: Path) -> tuple[Path, Path]:
    bare = tmp_path / "origin.git"
    source = tmp_path / "source"
    checkout = tmp_path / "checkout"
    run_git(tmp_path, "init", "--bare", str(bare))
    run_git(bare, "symbolic-ref", "HEAD", "refs/heads/main")
    run_git(tmp_path, "init", "--initial-branch=main", str(source))
    run_git(source, "config", "user.email", "tests@example.com")
    run_git(source, "config", "user.name", "AFAQ Tests")
    (source / "version.txt").write_text("one\n", encoding="utf-8")
    run_git(source, "add", "version.txt")
    run_git(source, "commit", "-m", "initial")
    run_git(source, "remote", "add", "origin", str(bare))
    run_git(source, "push", "-u", "origin", "main")
    run_git(tmp_path, "clone", str(bare), str(checkout))
    trusted_url = "https://github.com/afaqhost/afaq-harness-gateway.git"
    run_git(checkout, "remote", "set-url", "origin", trusted_url)
    run_git(checkout, "config", f"url.{bare.as_uri()}.insteadOf", trusted_url)
    return source, checkout


@pytest.mark.asyncio
async def test_clean_checkout_fast_forwards_to_latest_commit(git_checkouts: tuple[Path, Path]):
    source, checkout = git_checkouts
    (source / "version.txt").write_text("two\n", encoding="utf-8")
    run_git(source, "commit", "-am", "update")
    run_git(source, "push")

    update = await ProjectUpdateService(checkout, "afaqhost/afaq-harness-gateway", 10).pull_latest()

    assert update.updated is True
    assert update.branch == "main"
    assert (checkout / "version.txt").read_text(encoding="utf-8") == "two\n"


@pytest.mark.asyncio
async def test_local_changes_block_project_update(git_checkouts: tuple[Path, Path]):
    _, checkout = git_checkouts
    (checkout / "version.txt").write_text("locally changed\n", encoding="utf-8")

    with pytest.raises(ProjectUpdateConflictError, match="local changes"):
        await ProjectUpdateService(checkout, "afaqhost/afaq-harness-gateway", 10).pull_latest()


@pytest.mark.asyncio
async def test_untracked_files_do_not_block_project_update(git_checkouts: tuple[Path, Path]):
    _, checkout = git_checkouts
    (checkout / "local.txt").write_text("not committed\n", encoding="utf-8")

    update = await ProjectUpdateService(checkout, "afaqhost/afaq-harness-gateway", 10).pull_latest()

    assert update.updated is False
    assert (checkout / "local.txt").read_text(encoding="utf-8") == "not committed\n"


@pytest.mark.asyncio
async def test_untrusted_origin_blocks_project_update(git_checkouts: tuple[Path, Path]):
    _, checkout = git_checkouts
    run_git(checkout, "remote", "set-url", "origin", "https://github.com/example/untrusted.git")

    with pytest.raises(ProjectUpdateUnavailableError, match="configured repository"):
        await ProjectUpdateService(checkout, "afaqhost/afaq-harness-gateway", 10).pull_latest()

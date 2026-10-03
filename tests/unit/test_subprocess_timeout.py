import asyncio
import sys

import pytest

from app.clients.base import communicate_with_timeout

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_communicate_with_timeout_terminates_and_reaps_on_timeout():
    """Proves communicate_with_timeout kills and reaps child process and closes pipe transports on timeout."""
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import time, sys; sys.stdout.write('start\\n'); sys.stdout.flush(); time.sleep(10)",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.returncode is None

    with pytest.raises(asyncio.TimeoutError):
        await communicate_with_timeout(proc, timeout=0.05)

    # Process must be reaped and terminated
    assert proc.returncode is not None

    # Pipe transports must reach closed/EOF state without leaking
    if proc.stdout is not None:
        assert proc.stdout.at_eof() or proc._transport is None or proc._transport.is_closing()
    if proc.stderr is not None:
        assert proc.stderr.at_eof() or proc._transport is None or proc._transport.is_closing()


@pytest.mark.asyncio
async def test_communicate_with_timeout_terminates_on_task_cancellation():
    """Proves communicate_with_timeout cleans up subprocess when outer task is cancelled."""
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import time; time.sleep(10)",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    assert proc.returncode is None

    task = asyncio.create_task(communicate_with_timeout(proc, timeout=10.0))
    await asyncio.sleep(0.05)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    # Process must be reaped and terminated
    assert proc.returncode is not None


@pytest.mark.asyncio
async def test_communicate_with_timeout_normal_completion():
    """Proves communicate_with_timeout returns stdout and stderr correctly when process finishes normally."""
    proc = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import sys; sys.stdout.write('out-ok\\n'); sys.stderr.write('err-ok\\n')",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await communicate_with_timeout(proc, timeout=5.0)

    assert b"out-ok" in stdout
    assert b"err-ok" in stderr
    assert proc.returncode == 0

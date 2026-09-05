import asyncio
import pytest

from app.services.process_registry import ProcessHandle, ProcessRegistry

pytestmark = pytest.mark.unit


class DummyProcess:
    def __init__(self):
        self.pid = 1234
        self.returncode = None
        self.killed = False
        self.wait_called = False

    def kill(self):
        if self.killed:
            raise ProcessLookupError("already killed")
        self.killed = True

    async def wait(self):
        self.wait_called = True
        # simulate quick exit after kill
        if self.killed:
            self.returncode = -9
        return self.returncode

    def terminate(self):
        self.killed = True


@pytest.mark.asyncio
async def test_register_and_cancel_kills_process():
    registry = ProcessRegistry()
    proc = DummyProcess()
    handle = ProcessHandle(pid=proc.pid, process=proc, harness="opencode", model="m", request_id="req-1")
    await registry.register("req-1", handle)
    assert registry.size() == 1
    ok = await registry.cancel("req-1")
    assert ok is True
    assert proc.killed is True
    assert registry.size() == 0
    # second cancel should be false (idempotent)
    ok2 = await registry.cancel("req-1")
    assert ok2 is False


@pytest.mark.asyncio
async def test_cancel_unknown_returns_false():
    registry = ProcessRegistry()
    ok = await registry.cancel("nonexistent")
    assert ok is False


@pytest.mark.asyncio
async def test_cleanup_removes_entry():
    registry = ProcessRegistry()
    proc = DummyProcess()
    handle = ProcessHandle(pid=proc.pid, process=proc, harness="opencode", model="m")
    await registry.register("a", handle)
    assert registry.size() == 1
    await registry.cleanup("a")
    assert registry.size() == 0
    # cleanup unknown is no-op
    await registry.cleanup("unknown")
    assert registry.size() == 0


@pytest.mark.asyncio
async def test_register_overwrites_existing():
    registry = ProcessRegistry()
    p1 = DummyProcess()
    p1.pid = 1
    p2 = DummyProcess()
    p2.pid = 2
    await registry.register("key", ProcessHandle(pid=1, process=p1, harness="a", model="m"))
    await registry.register("key", ProcessHandle(pid=2, process=p2, harness="a", model="m"))
    assert registry.size() == 1
    h = await registry.get("key")
    assert h.pid == 2


@pytest.mark.asyncio
async def test_cancel_with_real_subprocess():
    # real subprocess via sleep 10, ensure kill within 2s
    proc = await asyncio.create_subprocess_exec("sleep", "10", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    registry = ProcessRegistry()
    handle = ProcessHandle(pid=proc.pid, process=proc, harness="test", model="sleep", request_id="real-1")
    await registry.register("real-1", handle)
    # cancel should kill within 2s
    ok = await registry.cancel("real-1")
    assert ok is True
    # process should be terminated
    await asyncio.sleep(0.2)
    assert proc.returncode is not None
    assert registry.size() == 0


@pytest.mark.asyncio
async def test_concurrent_register_and_cancel_race():
    registry = ProcessRegistry()
    # simulate concurrent cancels
    proc = DummyProcess()
    await registry.register("race", ProcessHandle(pid=proc.pid, process=proc, harness="x", model="y"))
    # two concurrent cancels, one should succeed, one false
    results = await asyncio.gather(registry.cancel("race"), registry.cancel("race"))
    assert results.count(True) == 1
    assert results.count(False) == 1

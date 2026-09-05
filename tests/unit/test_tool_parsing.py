import json
import pytest

from app.clients.codex import CodexAdapter
from app.clients.opencode import OpenCodeAdapter
from app.clients.commandcode import CommandCodeAdapter
from app.clients.claude import ClaudeAdapter

pytestmark = pytest.mark.unit


def test_codex_parse_tool():
    adapter = CodexAdapter()
    line = json.dumps({"tool": {"name": "get_weather", "id": "call_123", "arguments": {"city": "Paris"}}})
    text, meta = adapter.parse_line(line, "codex//model")
    assert text == ""
    assert "tool_call" in meta
    assert meta["tool_call"]["function"]["name"] == "get_weather"
    assert meta["tool_call"]["id"] == "call_123"


def test_codex_parse_tool_call_key():
    adapter = CodexAdapter()
    line = json.dumps({"tool_call": {"name": "mytool", "id": "call_abc", "arguments": "{}"}})
    text, meta = adapter.parse_line(line, "codex//model")
    assert "tool_call" in meta


def test_opencode_parse_tool():
    adapter = OpenCodeAdapter()
    line = json.dumps({"type": "tool_call", "tool": {"name": "read_file", "id": "call_1", "arguments": {"path": "/tmp"}}})
    text, meta = adapter.parse_line(line, "opencode//model")
    assert text == ""
    assert "tool_call" in meta
    assert meta["tool_call"]["function"]["name"] == "read_file"


def test_commandcode_parse_tool():
    adapter = CommandCodeAdapter()
    line = json.dumps({"type": "tool_call", "tool": {"name": "run_command", "id": "call_2", "arguments": {"cmd": "ls"}}})
    text, meta = adapter.parse_line(line, "cmd//model")
    assert text == ""
    assert "tool_call" in meta
    assert meta["tool_call"]["function"]["name"] == "run_command"

    # also event.type tool_call
    line2 = json.dumps({"event": {"type": "tool_call", "tool": {"name": "x", "id": "1"}}})
    text2, meta2 = adapter.parse_line(line2, "cmd//model")
    assert "tool_call" in meta2


def test_claude_parse_tool():
    adapter = ClaudeAdapter()
    line = json.dumps({"type": "content_block_delta", "delta": {"type": "tool_use", "id": "call_3", "name": "get_weather", "input": {"city": "Berlin"}}})
    text, meta = adapter.parse_line(line, "claude//model")
    assert text == ""
    assert "tool_call" in meta
    assert meta["tool_call"]["function"]["name"] == "get_weather"


def test_parse_normal_text_not_tool():
    adapter = CodexAdapter()
    line = json.dumps({"text": "hello world"})
    text, meta = adapter.parse_line(line, "codex//model")
    assert text == "hello world"
    assert "tool_call" not in meta

    # also plain text line
    text2, meta2 = adapter.parse_line("plain hello", "codex//model")
    assert text2 == "plain hello"

import pytest

from app.shared.prompt_utils import build_harness_prompt, build_history_prompt, extract_system_prompt
pytestmark = pytest.mark.unit


def test_build_history_prompt_concatenates_role_content_lines():
    prompt = build_history_prompt([("user", "hello"), ("assistant", "hi")])
    assert prompt == "user: hello\nassistant: hi"


def test_build_history_prompt_empty_returns_empty_string():
    assert build_history_prompt([]) == ""


def test_build_harness_prompt_prepends_system_when_present():
    result = build_harness_prompt("You are helpful", "user: hi")
    assert result.startswith("SYSTEM: You are helpful")
    assert "user: hi" in result


def test_build_harness_prompt_returns_history_when_no_system():
    assert build_harness_prompt(None, "user: hi") == "user: hi"
    assert build_harness_prompt("", "user: hi") == "user: hi"


def test_extract_system_prompt_separates_system_messages():
    messages = [
        {"role": "system", "content": "be concise"},
        {"role": "user", "content": "hello"},
        {"role": "system", "content": "be friendly"},
        {"role": "assistant", "content": "hi"},
    ]
    system, other = extract_system_prompt(messages, default="default prompt")
    assert system == "be concise\nbe friendly"
    assert all(m["role"] != "system" for m in other)
    assert len(other) == 2


def test_extract_system_prompt_falls_back_to_default_when_no_system():
    messages = [{"role": "user", "content": "hello"}]
    system, other = extract_system_prompt(messages, default="fallback")
    assert system == "fallback"
    assert other == messages


def test_extract_system_prompt_empty_default():
    system, other = extract_system_prompt([{"role": "user", "content": "hi"}], default=None)
    assert system is None
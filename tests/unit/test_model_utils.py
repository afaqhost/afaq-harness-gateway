import pytest

from app.shared.model_utils import parse_model_identifier, preview_text, split_model
pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("opencode//opencode/big-pickle", ("opencode", "opencode/big-pickle")),
        ("commandcode//deepseek/deepseek-v4-flash", ("commandcode", "deepseek/deepseek-v4-flash")),
        ("claude/sonnet", ("claude", "sonnet")),
        ("codex", ("codex", "default")),
        ("", ("", "default")),
        ("harness//provider/model/extra", ("harness", "provider/model/extra")),
    ],
)
def test_parse_model_identifier_maps_public_form_to_harness_and_model(raw, expected):
    assert parse_model_identifier(raw) == expected


def test_split_model_alias_delegates_to_parse_model_identifier():
    assert split_model("opencode//opencode/big-pickle") == parse_model_identifier("opencode//opencode/big-pickle")


@pytest.mark.parametrize(
    "text,max_len,should_truncate",
    [
        ("hello world", 80, False),
        ("a" * 81, 80, True),
        ("line1\nline2", 80, False),
    ],
)
def test_preview_text_handles_single_line_newline_and_truncation(text, max_len, should_truncate):
    preview = preview_text(text, max_len=max_len)
    assert "\n" not in preview
    if should_truncate:
        assert preview.endswith("…")
        assert len(preview) == max_len + 1
    else:
        assert "…" not in preview or len(text.strip().replace("\n", " ")) <= max_len


def test_preview_text_empty_returns_empty():
    assert preview_text("") == ""
    assert preview_text("   ") == ""


def test_preview_text_strips_and_collapses_newlines():
    assert preview_text("  hello\nworld  ", max_len=80) == "hello world"
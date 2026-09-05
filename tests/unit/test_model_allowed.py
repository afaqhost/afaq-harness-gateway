import pytest
from app.services.model_service import is_model_allowed

pytestmark = pytest.mark.unit


def test_is_model_allowed_none_allows_all():
    assert is_model_allowed("opencode//opencode/big-pickle", None) is True
    assert is_model_allowed("anything", []) is True


def test_is_model_allowed_exact_match():
    assert is_model_allowed("opencode//opencode/big-pickle", ["opencode//opencode/big-pickle"]) is True
    assert is_model_allowed("commandcode//deepseek/deepseek-v4-flash", ["opencode//opencode/big-pickle"]) is False


def test_is_model_allowed_wildcard():
    assert is_model_allowed("opencode//opencode/big-pickle", ["opencode/*"]) is True
    assert is_model_allowed("commandcode//deepseek/deepseek-v4-flash", ["opencode/*"]) is False
    assert is_model_allowed("opencode//opencode/claude-sonnet-4", ["opencode/*"]) is True


def test_is_model_allowed_bare_prefix():
    # bare prefix without star should also work per convenience (opencode matches any opencode)
    assert is_model_allowed("opencode//opencode/big-pickle", ["opencode"]) is True
    assert is_model_allowed("commandcode//deepseek/deepseek-v4-flash", ["opencode"]) is False

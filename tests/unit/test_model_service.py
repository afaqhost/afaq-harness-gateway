import pytest
from fastapi import HTTPException

from app.clients.registry import MODEL_CACHE
from app.models.harness import HarnessModel
from app.services.model_service import select_model_for_conversation, select_model_for_new_conversation, validate_model_or_400
pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def isolate_model_cache(monkeypatch):
    MODEL_CACHE.clear()
    yield
    MODEL_CACHE.clear()


def seed(harness: str, ids: list[str]):
    MODEL_CACHE[harness] = [HarnessModel(id=i, harness=harness, provider=None, name=i) for i in ids]


def test_validate_model_rejects_unknown_harness():
    with pytest.raises(HTTPException) as ei:
        validate_model_or_400("unknown//model")
    assert ei.value.status_code == 400
    assert "Unknown harness" in str(ei.value.detail)


def test_validate_model_rejects_codex_as_unavailable():
    seed("codex", ["codex//o3"])
    with pytest.raises(HTTPException) as ei:
        validate_model_or_400("codex//o3")
    assert ei.value.status_code == 400
    assert "codex" in str(ei.value.detail).lower()


def test_validate_model_rejects_unknown_model_when_cache_populated():
    seed("opencode", ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4"])
    with pytest.raises(HTTPException) as ei:
        validate_model_or_400("opencode//unknown-model")
    assert ei.value.status_code == 400
    assert "غير متوفر" in str(ei.value.detail)


def test_validate_model_accepts_known_model():
    seed("opencode", ["opencode//opencode/big-pickle"])
    harness, model = validate_model_or_400("opencode//opencode/big-pickle")
    assert harness == "opencode"
    assert model == "opencode/big-pickle"


def test_validate_model_accepts_unknown_when_no_cache():
    # no cached models -> any model for that harness is accepted (aside from codex block)
    harness, model = validate_model_or_400("commandcode//any/model")
    assert harness == "commandcode"


def test_select_new_conversation_returns_requested_when_valid():
    seed("opencode", ["opencode//opencode/big-pickle"])
    assert select_model_for_new_conversation("opencode//opencode/big-pickle") == "opencode//opencode/big-pickle"


def test_select_new_conversation_falls_back_to_preferred():
    seed("opencode", ["opencode//opencode/big-pickle"])
    assert select_model_for_new_conversation(None) == "opencode//opencode/big-pickle"


def test_select_new_conversation_falls_back_to_any_harness_when_preferred_missing():
    seed("commandcode", ["commandcode//deepseek/deepseek-v4-flash"])
    result = select_model_for_new_conversation(None)
    assert result == "commandcode//deepseek/deepseek-v4-flash"


def test_select_for_conversation_prefers_requested_over_conversation():
    seed("opencode", ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4"])
    assert select_model_for_conversation("opencode//opencode/claude-sonnet-4", "opencode//opencode/big-pickle") == "opencode//opencode/claude-sonnet-4"


def test_select_for_conversation_uses_conversation_model_when_no_request():
    assert select_model_for_conversation(None, "opencode//existing") == "opencode//existing"
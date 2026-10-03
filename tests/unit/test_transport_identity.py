import pytest
from fastapi import HTTPException

from app.transport.identity import (
    build_history_key,
    generate_stream_id,
    resolve_stream_identity,
    validate_last_event_id,
    validate_stream_id,
)

pytestmark = pytest.mark.unit


def test_validate_stream_id_valid():
    assert validate_stream_id("valid-stream-id_123") == "valid-stream-id_123"
    assert validate_stream_id("a" * 128) == "a" * 128


def test_validate_stream_id_invalid():
    with pytest.raises(HTTPException) as exc:
        validate_stream_id("has:colons")
    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "invalid_stream_id"

    with pytest.raises(HTTPException):
        validate_stream_id("has spaces")

    with pytest.raises(HTTPException):
        validate_stream_id("a" * 129)

    with pytest.raises(HTTPException):
        validate_stream_id("")


def test_validate_last_event_id():
    assert validate_last_event_id(None) is None
    assert validate_last_event_id("0") == 0
    assert validate_last_event_id("42") == 42

    with pytest.raises(HTTPException) as exc:
        validate_last_event_id("-1")
    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "invalid_last_event_id"

    with pytest.raises(HTTPException):
        validate_last_event_id("abc")


def test_build_history_key():
    assert build_history_key("openai", 1, "s1") == "openai:1:s1"
    assert build_history_key("conv", 1, "s1", resource_id=10) == "conv:1:10:s1"

    with pytest.raises(ValueError):
        build_history_key("conv", 1, "s1", resource_id=None)

    with pytest.raises(ValueError):
        build_history_key("unknown", 1, "s1")  # type: ignore[arg-type]


def test_resolve_stream_identity_new():
    class DummyStore:
        def has_history(self, key):
            return False

    ident = resolve_stream_identity(
        endpoint="openai",
        user_id=1,
        stream_id=None,
        last_event_id=None,
        history=DummyStore(),
    )
    assert ident.stream_id is not None
    assert len(ident.stream_id) == 32
    assert ident.history_key == f"openai:1:{ident.stream_id}"
    assert ident.last_event_id is None
    assert not ident.is_reconnect


def test_resolve_stream_identity_missing_stream_id_on_reconnect():
    class DummyStore:
        def has_history(self, key):
            return True

    with pytest.raises(HTTPException) as exc:
        resolve_stream_identity(
            endpoint="openai",
            user_id=1,
            stream_id=None,
            last_event_id="5",
            history=DummyStore(),
        )
    assert exc.value.status_code == 400
    assert exc.value.detail["error"]["code"] == "missing_stream_id"


def test_resolve_stream_identity_conflict():
    class DummyStore:
        def has_history(self, key):
            return True

    with pytest.raises(HTTPException) as exc:
        resolve_stream_identity(
            endpoint="openai",
            user_id=1,
            stream_id="existing-id",
            last_event_id=None,
            history=DummyStore(),
        )
    assert exc.value.status_code == 409
    assert exc.value.detail["error"]["code"] == "stream_id_conflict"


def test_resolve_stream_identity_not_found():
    class DummyStore:
        def has_history(self, key):
            return False

    with pytest.raises(HTTPException) as exc:
        resolve_stream_identity(
            endpoint="openai",
            user_id=1,
            stream_id="expired-id",
            last_event_id="3",
            history=DummyStore(),
        )
    assert exc.value.status_code == 404
    assert exc.value.detail["error"]["code"] == "stream_not_found"


def test_resolve_stream_identity_default_history():
    ident = resolve_stream_identity(
        endpoint="openai",
        user_id=1,
        stream_id=None,
        last_event_id=None,
    )
    assert ident.stream_id is not None
    assert ident.history_key == f"openai:1:{ident.stream_id}"

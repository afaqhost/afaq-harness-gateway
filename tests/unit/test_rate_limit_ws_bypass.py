"""Unit test for the rate-limit middleware bypass on WebSocket routes.

Starlette's BaseHTTPMiddleware doesn't handle WS upgrades cleanly — if
the middleware buffers the request body before the route handler can
accept the WS handshake, the browser sees a generic "WebSocket
connection failed" with no detail. The fix is a fast-path skip for any
path ending in /ws.
"""

from __future__ import annotations

import pytest

from starlette.requests import Request

from app.middleware.rate_limit import RateLimitMiddleware


class _FakeLimiter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def allow(self, key: str, limit: int, window_s: int) -> tuple[bool, int]:
        self.calls.append(key)
        return True, 0


class _FakeSend:
    async def __call__(self, message):
        return None


def _make_request(path: str, headers: dict | None = None) -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
        "scheme": "http",
        "http_version": "1.1",
    }
    return Request(scope)


@pytest.mark.asyncio
async def test_rate_limit_bypasses_ws_path():
    limiter = _FakeLimiter()
    calls: list[str] = []

    async def call_next(request: Request):
        calls.append(request.url.path)
        from starlette.responses import Response
        return Response("ok")

    middleware = RateLimitMiddleware(app=None, limiter=limiter)
    # Bypass path
    req = _make_request("/api/admin/terminal/abc123/ws", {"authorization": "Bearer x"})
    response = await middleware.dispatch(req, call_next)
    assert response.status_code == 200
    assert calls == ["/api/admin/terminal/abc123/ws"]
    assert limiter.calls == [], "rate limiter must NOT be called for /ws paths"


@pytest.mark.asyncio
async def test_rate_limit_enforces_normal_paths():
    limiter = _FakeLimiter()
    calls: list[str] = []

    async def call_next(request: Request):
        calls.append(request.url.path)
        from starlette.responses import Response
        return Response("ok")

    middleware = RateLimitMiddleware(app=None, limiter=limiter)
    req = _make_request("/v1/models")
    response = await middleware.dispatch(req, call_next)
    assert response.status_code == 200
    assert calls == ["/v1/models"]
    assert limiter.calls, "rate limiter MUST be called for normal paths"


# ---------- LoggingMiddleware + RequestIdMiddleware same bypass ----------

from app.middleware.logging import LoggingMiddleware
from app.middleware.request_id import RequestIdMiddleware


@pytest.mark.asyncio
async def test_logging_middleware_bypasses_ws_path():
    calls: list[str] = []

    async def call_next(request: Request):
        calls.append(request.url.path)
        from starlette.responses import Response
        return Response("ok")

    middleware = LoggingMiddleware(app=None)
    req = _make_request("/api/admin/terminal/abc/ws")
    response = await middleware.dispatch(req, call_next)
    assert response.status_code == 200
    assert calls == ["/api/admin/terminal/abc/ws"], "logging middleware must not block WS handshake"


@pytest.mark.asyncio
async def test_request_id_middleware_bypasses_ws_path():
    calls: list[str] = []

    async def call_next(request: Request):
        calls.append(request.url.path)
        from starlette.responses import Response
        return Response("ok")

    middleware = RequestIdMiddleware(app=None)
    req = _make_request("/api/admin/terminal/abc/ws")
    response = await middleware.dispatch(req, call_next)
    assert response.status_code == 200
    assert calls == ["/api/admin/terminal/abc/ws"], "request-id middleware must not block WS handshake"


@pytest.mark.asyncio
async def test_logging_middleware_enforces_normal_paths():
    calls: list[str] = []

    async def call_next(request: Request):
        calls.append(request.url.path)
        from starlette.responses import Response
        return Response("ok")

    middleware = LoggingMiddleware(app=None)
    req = _make_request("/v1/models")
    response = await middleware.dispatch(req, call_next)
    assert response.status_code == 200
    assert calls == ["/v1/models"]


@pytest.mark.asyncio
async def test_request_id_middleware_enforces_normal_paths():
    calls: list[str] = []

    async def call_next(request: Request):
        calls.append(request.url.path)
        from starlette.responses import Response
        return Response("ok")

    middleware = RequestIdMiddleware(app=None)
    req = _make_request("/v1/models")
    response = await middleware.dispatch(req, call_next)
    assert response.status_code == 200
    assert calls == ["/v1/models"]
    assert response.headers.get("X-Request-ID"), "request id must be set for normal paths"

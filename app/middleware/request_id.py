import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # BaseHTTPMiddleware does not support WebSocket upgrades — skip the
        # request_id tagging (the WS handler logs its own id) so the
        # handshake reaches the route handler without buffering the request.
        if request.url.path.endswith("/ws"):
            return await call_next(request)
        rid = request.headers.get("X-Request-ID", uuid.uuid4().hex[:12])
        request.state.request_id = rid
        response = await call_next(request)
        response.headers["X-Request-ID"] = rid
        return response

import json
import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

logger = logging.getLogger("afaq")


class LoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = int((time.monotonic() - start) * 1000)
        # redact Authorization
        headers = dict(request.headers)
        if "authorization" in headers:
            headers["authorization"] = "***"
        log_data = {
            "request_id": getattr(request.state, "request_id", "-"),
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
        }
        # add harness/model if available via request state? For now just basic
        # also include user_id if available? Not yet
        logger.info(json.dumps(log_data))
        return response

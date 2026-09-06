from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter()

# Try to import prometheus_client; if not available, metrics will be disabled
try:
    from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

    REQUEST_COUNT = Counter("afaq_requests_total", "Total requests", ["method", "path", "status"])
    HARNESS_CALLS = Counter("afaq_harness_calls_total", "Harness calls", ["harness", "model"])
    HARNESS_LATENCY = Histogram("afaq_harness_latency_ms", "Harness latency ms", ["harness"])
    _PROM_AVAILABLE = True
except ImportError:
    CONTENT_TYPE_LATEST = "text/plain"
    REQUEST_COUNT = None
    HARNESS_CALLS = None
    HARNESS_LATENCY = None
    _PROM_AVAILABLE = False

    def generate_latest():
        return b""


@router.get("/metrics")
async def metrics():
    if not _PROM_AVAILABLE:
        raise HTTPException(status_code=501, detail={"error": {"code": "not_found", "message": "metrics not installed"}})
    try:
        data = generate_latest()
        return Response(content=data, media_type=CONTENT_TYPE_LATEST)
    except (OSError, RuntimeError) as e:
        raise HTTPException(status_code=500, detail={"error": {"code": "harness_error", "message": str(e)}})

import pytest
from pydantic import ValidationError

from app.core.config import Settings, settings

pytestmark = pytest.mark.security


@pytest.mark.parametrize("debug", [False, True])
@pytest.mark.parametrize(
    "origins",
    ["*", "https://trusted.example, *", "https://*.example", "null",
     "https://trusted.example/path", "https://user:password@trusted.example", "trusted.example",
     "https://trusted.example:invalid", "https://trusted.example:65536", "https://trusted.example/",
     "https://trusted.example?query", "https://trusted.example#fragment", "https://trusted .example",
     "https://trusted.example?", "https://trusted.example#"],
)
def test_unsafe_cors_origins_are_rejected(origins, debug):
    with pytest.raises(ValidationError, match="allowed_origins"):
        Settings(_env_file=None, allowed_origins=origins, debug=debug)


@pytest.mark.parametrize("origins", ["", "http://localhost:3500", " https://app.example , http://[::1]:3500 "])
def test_explicit_or_empty_cors_origins_are_accepted(origins):
    assert Settings(_env_file=None, allowed_origins=origins).allowed_origins == origins


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["GET", "HEAD", "POST", "PATCH", "DELETE"])
async def test_allowed_origin_can_preflight_supported_requests(client, method):
    origin = settings.allowed_origins.split(",")[0].strip()
    response = await client.options("/v1/chat/completions", headers={
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "authorization,content-type,x-api-key,x-request-id,x-stream-id,last-event-id",
    })

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == origin
    assert response.headers["Access-Control-Allow-Credentials"] == "true"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("origin", "method", "header"),
    [("https://untrusted.invalid", "POST", "authorization"),
     (None, "PUT", "authorization"), (None, "POST", "x-unapproved-header")],
)
async def test_cors_rejects_untrusted_origin_method_or_header(client, origin, method, header):
    trusted_origin = settings.allowed_origins.split(",")[0].strip()
    response = await client.options("/v1/chat/completions", headers={
        "Origin": origin or trusted_origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": header,
    })

    assert response.status_code == 400
    if origin is not None:
        assert "Access-Control-Allow-Origin" not in response.headers


@pytest.mark.asyncio
async def test_allowed_origin_exposes_stream_identity_headers(client):
    origin = settings.allowed_origins.split(",")[0].strip()
    response = await client.get("/v1/models", headers={"Origin": origin})

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == origin
    exposed_headers = {header.strip().lower() for header in response.headers["Access-Control-Expose-Headers"].split(",")}
    assert {"x-request-id", "x-stream-id"} <= exposed_headers


@pytest.mark.asyncio
async def test_untrusted_browser_cannot_read_response(client):
    response = await client.get("/v1/models", headers={"Origin": "https://untrusted.invalid"})

    assert response.status_code == 200
    assert "Access-Control-Allow-Origin" not in response.headers

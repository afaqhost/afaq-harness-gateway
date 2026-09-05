from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
import os

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.db.database import get_db, init_db
from app.shared.errors import ErrorCode, error_payload
from app.api.openai import router as openai_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.chat import router as chat_router
from app.api.usage import router as usage_router
from app.api.credentials import router as credentials_router
from app.api.metrics import router as metrics_router
from app.harnesses.registry import refresh_models
from app.middleware.logging import LoggingMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.middleware.request_id import RequestIdMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # harvest env credentials into credential_profiles for admin (best-effort)
    try:
        from app.db.database import CredentialProfile, SessionLocal, User
        from app.core.security import encrypt_secret
        from sqlalchemy import select as _select

        # mapping env var -> harness
        env_map = {
            "ANTHROPIC_API_KEY": "claude",
            "OPENAI_API_KEY": "opencode",
            "CODEX_API_KEY": "codex",
            "COMMAND_CODE_TOKEN": "commandcode",
            "OPENSOURCE_API_KEY": "opencode",
        }
        async with SessionLocal() as session:
            # find first admin user if exists
            admin = (await session.execute(_select(User).where(User.role == "admin").limit(1))).scalar_one_or_none()
            if admin:
                for env_var, harness in env_map.items():
                    raw = os.getenv(env_var)
                    if not raw:
                        continue
                    # check if profile already exists
                    existing = (await session.execute(_select(CredentialProfile).where(CredentialProfile.user_id == admin.id, CredentialProfile.harness == harness, CredentialProfile.profile_name == "default"))).scalar_one_or_none()
                    if existing:
                        continue
                    enc = encrypt_secret(raw)
                    prof = CredentialProfile(user_id=admin.id, harness=harness, profile_name="default", auth_type="environment", encrypted_token=enc, status="unknown")
                    session.add(prof)
                await session.commit()
    except Exception:
        # never fail startup due to harvest
        pass
    await refresh_models()
    yield

app = FastAPI(title=settings.app_name, version=settings.version, description="OpenAI-compatible gateway for terminal AI harnesses", lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    # if already in unified shape, preserve
    if isinstance(exc.detail, dict) and "error" in exc.detail and isinstance(exc.detail["error"], dict) and "code" in exc.detail["error"]:
        return JSONResponse(status_code=exc.status_code, content=exc.detail, headers=getattr(exc, "headers", None))
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail}, headers=getattr(exc, "headers", None))
    # wrap plain string
    message = str(exc.detail) if exc.detail else "error"
    # map status to code
    code_map = {
        400: ErrorCode.validation_error,
        401: ErrorCode.auth_error,
        403: ErrorCode.model_forbidden,
        404: ErrorCode.not_found,
        409: ErrorCode.conflict,
        429: ErrorCode.rate_limited,
        502: ErrorCode.harness_error,
        504: ErrorCode.harness_error,
    }
    code = code_map.get(exc.status_code, ErrorCode.validation_error)
    # special cases for quota, malformed etc. try to infer from message
    low = message.lower()
    if "quota" in low:
        code = ErrorCode.quota_exceeded
    elif "malformed" in low:
        code = ErrorCode.malformed_output
    elif "rate" in low:
        code = ErrorCode.rate_limited
    return JSONResponse(status_code=exc.status_code, content=error_payload(code, message), headers=getattr(exc, "headers", None))


# Middleware order: CORS outermost, then RequestId, Logging, RateLimit innermost
# (last added = outermost)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(LoggingMiddleware)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.allowed_origins.split(",") if o.strip()], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")
app.include_router(openai_router, prefix="/v1")
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])
app.include_router(usage_router, prefix="/api/chat", tags=["usage"])
app.include_router(credentials_router, prefix="/api/admin", tags=["credentials"])
app.include_router(metrics_router)

async def render_page(request: Request, page: str):
    return templates.TemplateResponse("index.html", {"request": request, "app_name": settings.app_name, "page": page})

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return await render_page(request, "chat")

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return await render_page(request, "login")

@app.get("/chat", response_class=HTMLResponse)
async def chat_page(request: Request):
    return await render_page(request, "chat")

@app.get("/harnesses", response_class=HTMLResponse)
async def harnesses_page(request: Request):
    return await render_page(request, "harnesses")

@app.get("/keys", response_class=HTMLResponse)
async def keys_page(request: Request):
    return await render_page(request, "keys")

@app.get("/users", response_class=HTMLResponse)
async def users_page(request: Request):
    return await render_page(request, "users")

@app.get("/usage", response_class=HTMLResponse)
async def usage_page(request: Request):
    return await render_page(request, "usage")

@app.get("/documentation", response_class=HTMLResponse)
async def documentation_page(request: Request):
    return await render_page(request, "documentation")

@app.get("/health")
async def health(db = Depends(get_db)):
    # fast health: check gateway + per-harness installed flag without calling list_models
    from sqlalchemy import select
    from app.db.database import Harness
    from app.harnesses.registry import all_adapters

    try:
        rows = {h.name: h for h in (await db.execute(select(Harness))).scalars().all()}
    except Exception:
        rows = {}
    harnesses = []
    for adapter in all_adapters():
        installed = adapter.is_installed()
        row = rows.get(adapter.name)
        harnesses.append(
            {
                "name": adapter.name,
                "installed": installed,
                "last_checked_at": row.last_checked_at.isoformat() if row and row.last_checked_at else None,
            }
        )
    return {"status": "ok", "service": settings.app_name, "version": settings.version, "harnesses": harnesses}

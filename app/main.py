from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from fastapi import Request
from app.core.config import settings
from app.db.database import init_db
from app.api.openai import router as openai_router
from app.api.auth import router as auth_router
from app.api.admin import router as admin_router
from app.api.chat import router as chat_router
from app.api.usage import router as usage_router
from app.harnesses.registry import refresh_models
from app.middleware.rate_limit import RateLimitMiddleware

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await refresh_models()
    yield

app = FastAPI(title=settings.app_name, version=settings.version, description="OpenAI-compatible gateway for terminal AI harnesses", lifespan=lifespan)
# Rate limiting before CORS so CORS preflight is handled outermost (last added = outermost)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.allowed_origins.split(",") if o.strip()], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates")
app.include_router(openai_router, prefix="/v1")
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
app.include_router(chat_router, prefix="/api/chat", tags=["chat"])
app.include_router(usage_router, prefix="/api/chat", tags=["usage"])

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

@app.get("/documentation", response_class=HTMLResponse)
async def documentation_page(request: Request):
    return await render_page(request, "documentation")

@app.get("/health")
async def health():
    return {"status": "ok", "service": settings.app_name, "version": settings.version}

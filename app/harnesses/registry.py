from __future__ import annotations
import asyncio, json, os, shutil, time
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator
from app.core.config import settings

@dataclass
class HarnessModel:
    id: str
    harness: str
    provider: str | None
    name: str
    context_window: int | None = None
    pricing: dict = field(default_factory=dict)

@dataclass
class HarnessResult:
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0
    raw: dict | str | None = None
    finish_reason: str = "stop"

class HarnessAdapter(ABC):
    name: str = "custom"
    display_name: str = "Custom Harness"
    executable: str = ""
    provider: str = ""
    install_command: list[str] = []
    update_command: list[str] = []

    def is_installed(self) -> bool:
        return shutil.which(self.executable) is not None

    async def install(self) -> AsyncIterator[dict]:
        if not self.install_command:
            yield {"stage": "error", "message": "No install recipe configured"}
            return
        yield {"stage": "started", "message": "Installing harness"}
        process = await asyncio.create_subprocess_exec(*self.install_command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        assert process.stdout
        async for line in process.stdout:
            yield {"stage": "running", "message": line.decode(errors="replace").rstrip()}
        code = await process.wait()
        yield {"stage": "completed" if code == 0 else "failed", "exit_code": code}

    async def update(self) -> AsyncIterator[dict]:
        if not self.update_command:
            yield {"stage": "error", "message": "No update recipe configured"}
            return
        process = await asyncio.create_subprocess_exec(*self.update_command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        assert process.stdout
        async for line in process.stdout:
            yield {"stage": "running", "message": line.decode(errors="replace").rstrip()}
        yield {"stage": "completed" if await process.wait() == 0 else "failed"}

    async def authenticate(self, mode: str = "environment") -> dict:
        return {"mode": mode, "status": "manual_required", "message": "Use the harness official login flow or environment variables."}

    async def list_models(self) -> list[HarnessModel]:
        return []

    @abstractmethod
    def build_command(self, prompt: str, model: str | None = None, session_id: str | None = None) -> list[str]: ...

    def parse_line(self, line: str, model: str) -> tuple[str, dict]:
        return line, {}

    def parse_output(self, output: bytes, model: str) -> str:
        return output.decode(errors="replace").strip()

    async def run(self, prompt: str, model: str | None = None, session_id: str | None = None, env: dict | None = None) -> HarnessResult:
        model = model or "default"
        command = self.build_command(prompt, model, session_id)
        started = time.monotonic()
        process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env={**os.environ, **(env or {})})
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=settings.harness_timeout_seconds)
        if process.returncode != 0:
            error = stderr.decode(errors="replace").strip() or stdout.decode(errors="replace").strip()
            raise RuntimeError(f"{self.name} failed ({process.returncode}): {error}")
        text = self.parse_output(stdout, model)
        return HarnessResult(text=text, model=model, raw={"stderr": stderr.decode(errors="replace"), "latency_ms": int((time.monotonic()-started)*1000)})

    async def stream(self, prompt: str, model: str | None = None, session_id: str | None = None, env: dict | None = None) -> AsyncIterator[tuple[str, dict]]:
        model = model or "default"
        process = await asyncio.create_subprocess_exec(*self.build_command(prompt, model, session_id), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env={**os.environ, **(env or {})})
        assert process.stdout
        async for raw in process.stdout:
            line = raw.decode(errors="replace")
            text, metadata = self.parse_line(line, model)
            if text:
                yield text, metadata
        code = await process.wait()
        if code != 0:
            error = (await process.stderr.read()).decode(errors="replace")
            raise RuntimeError(f"{self.name} failed ({code}): {error}")

class ClaudeAdapter(HarnessAdapter):
    name, display_name, executable, provider = "claude", "Claude Code", "claude", ""
    install_command = ["npm", "install", "-g", "@anthropic-ai/claude-code"]
    update_command = ["npm", "update", "-g", "@anthropic-ai/claude-code"]
    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "-p", prompt, "--output-format", "stream-json"]
        if model and model != "default": command += ["--model", model]
        if session_id: command += ["--resume", session_id]
        return command
    async def list_models(self):
        if not self.is_installed(): return []
        return [HarnessModel(f"claude//{m}", self.name, None, m) for m in ["default", "sonnet", "opus", "haiku"]]

class CodexAdapter(HarnessAdapter):
    name, display_name, executable, provider = "codex", "Codex CLI", "codex", ""
    install_command = ["npm", "install", "-g", "@openai/codex"]
    update_command = ["npm", "update", "-g", "@openai/codex"]
    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "exec", "--json", "--skip-git-repo-check"]
        if model and model != "default": command += ["--model", model]
        command += [prompt]
        return command
    def parse_line(self, line, model):
        try:
            item = json.loads(line)
            text = item.get("text") or item.get("message") or item.get("content") or ""
            return text, item
        except json.JSONDecodeError:
            return line, {}
    async def list_models(self):
        cache_path = Path.home() / ".codex" / "models_cache.json"
        try:
            models = json.loads(cache_path.read_text()).get("models", [])
            model_ids = [item.get("slug") for item in models if isinstance(item, dict) and item.get("slug")]
        except (OSError, json.JSONDecodeError):
            model_ids = []
        if not model_ids: model_ids = ["default", "o3", "o4-mini"]
        return [HarnessModel(f"codex//{model}", self.name, None, model) for model in model_ids]

class OpenCodeAdapter(HarnessAdapter):
    name, display_name, executable, provider = "opencode", "OpenCode", "opencode", ""
    install_command = ["npm", "install", "-g", "opencode-ai"]
    update_command = ["npm", "update", "-g", "opencode-ai"]
    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "run", "--format", "json"]
        if model and model != "default": command += ["--model", model]
        if session_id: command += ["--session", session_id]
        command += [prompt]
        return command
    def parse_line(self, line, model):
        try:
            item = json.loads(line)
            part = item.get("part") or {}
            text = part.get("text") if item.get("type") == "text" else ""
            return text or item.get("text") or "", item
        except json.JSONDecodeError:
            return line, {}

    def parse_output(self, output: bytes, model: str) -> str:
        return "".join(self.parse_line(line, model)[0] for line in output.decode(errors="replace").splitlines()).strip()

    async def list_models(self):
        process = await asyncio.create_subprocess_exec(self.executable, "models", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=30)
        if process.returncode != 0: return []
        models = [line.strip() for line in stdout.decode(errors="replace").splitlines() if "/" in line.strip()]
        return [HarnessModel(f"{self.name}//{model}", self.name, model.split("/", 1)[0], model) for model in models]

class CommandCodeAdapter(HarnessAdapter):
    name, display_name, executable, provider = "commandcode", "Command Code", "cmd", ""
    install_command = ["npm", "install", "-g", "command-code"]
    update_command = ["npm", "update", "-g", "command-code"]

    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "--print", prompt, "--output-format", "json", "--skip-onboarding", "--no-auto-update"]
        if model and model != "default": command += ["--model", model]
        if session_id: command += ["--session", session_id]
        return command

    def parse_line(self, line, model):
        try:
            item = json.loads(line)
            event = item.get("event") or {}
            if item.get("type") == "result":
                text = item.get("finalText") or ""
            elif event.get("type") == "text_delta":
                text = event.get("delta") or ""
            elif event.get("type") == "message_end":
                text = ""
            else:
                text = item.get("text") or item.get("content") or ""
            usage = item.get("usage") or {}
            return text, {"usage": usage, "event": event.get("type") or item.get("type")}
        except json.JSONDecodeError:
            return line, {}

    def parse_output(self, output: bytes, model: str) -> str:
        lines = output.decode(errors="replace").splitlines()
        for line in lines:
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if item.get("type") == "result" and item.get("finalText"):
                return item["finalText"]
        return "".join(self.parse_line(line, model)[0] for line in lines).strip()

    async def list_models(self):
        process = await asyncio.create_subprocess_exec(self.executable, "--list-models", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=30)
        if process.returncode != 0: return []
        model_ids = []
        for line in stdout.decode(errors="replace").splitlines():
            candidate = line.strip()
            match = re.match(r"^([\w./:-]+)\s{2,}", candidate)
            if match and not match.group(1).lower().startswith(("docs", "open", "available")):
                model_ids.append(match.group(1))
        return [HarnessModel(f"{self.name}//{model}", self.name, model.split("/", 1)[0] if "/" in model else None, model) for model in model_ids]

class GenericAdapter(HarnessAdapter):
    def __init__(self, name: str, executable: str, provider: str = "", command_template: list[str] | None = None):
        self.name, self.display_name, self.executable, self.provider = name, name, executable, provider
        self.command_template = command_template or [executable, "{prompt}"]
    def build_command(self, prompt, model=None, session_id=None):
        return [part.replace("{prompt}", prompt).replace("{model}", model or "default") for part in self.command_template]

ADAPTERS: dict[str, HarnessAdapter] = {
    "claude": ClaudeAdapter(),
    "codex": CodexAdapter(),
    "opencode": OpenCodeAdapter(),
    "commandcode": CommandCodeAdapter(),
}

MODEL_CACHE: dict[str, list[HarnessModel]] = {}

async def refresh_models() -> None:
    for adapter in all_adapters():
        if adapter.is_installed():
            try:
                MODEL_CACHE[adapter.name] = await adapter.list_models()
            except (OSError, asyncio.TimeoutError):
                MODEL_CACHE[adapter.name] = []
        else:
            MODEL_CACHE[adapter.name] = []

def cached_models(adapter_name: str) -> list[HarnessModel]:
    return MODEL_CACHE.get(adapter_name, [])

def get_adapter(name: str) -> HarnessAdapter:
    if name not in ADAPTERS: raise KeyError(f"Unknown harness: {name}")
    return ADAPTERS[name]

def all_adapters() -> list[HarnessAdapter]:
    return list(ADAPTERS.values())

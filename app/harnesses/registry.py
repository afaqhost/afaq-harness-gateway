from __future__ import annotations

import asyncio
import json
import re
from pathlib import Path

from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel

# Re-export for backwards compatibility — new code should import from app.clients.*
__all__ = [
    "HarnessAdapter",
    "ClaudeAdapter",
    "CodexAdapter",
    "OpenCodeAdapter",
    "CommandCodeAdapter",
    "GenericAdapter",
    "ADAPTERS",
    "MODEL_CACHE",
    "refresh_models",
    "cached_models",
    "get_adapter",
    "all_adapters",
]


class ClaudeAdapter(HarnessAdapter):
    name, display_name, executable, provider = "claude", "Claude Code", "claude", ""
    install_command = ["npm", "install", "-g", "@anthropic-ai/claude-code"]
    update_command = ["npm", "update", "-g", "@anthropic-ai/claude-code"]

    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "-p", prompt, "--output-format", "stream-json"]
        if model and model != "default":
            command += ["--model", model]
        if session_id:
            command += ["--resume", session_id]
        return command

    async def list_models(self):
        if not self.is_installed():
            return []
        return [HarnessModel(f"claude//{m}", self.name, None, m) for m in ["default", "sonnet", "opus", "haiku"]]


class CodexAdapter(HarnessAdapter):
    name, display_name, executable, provider = "codex", "Codex CLI", "codex", ""
    install_command = ["npm", "install", "-g", "@openai/codex"]
    update_command = ["npm", "update", "-g", "@openai/codex"]

    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only"]
        if model and model != "default":
            command += ["--model", model]
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
        if not model_ids:
            model_ids = ["default", "o3", "o4-mini"]
        return [HarnessModel(f"codex//{model}", self.name, None, model) for model in model_ids]


class OpenCodeAdapter(HarnessAdapter):
    name, display_name, executable, provider = "opencode", "OpenCode", "opencode", ""
    install_command = ["npm", "install", "-g", "opencode-ai"]
    update_command = ["npm", "update", "-g", "opencode-ai"]

    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "run", "--format", "json"]
        if model and model != "default":
            command += ["--model", model]
        if session_id:
            command += ["--session", session_id]
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
        process = await asyncio.create_subprocess_exec(
            self.executable, "models", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=30)
        if process.returncode != 0:
            return []
        models = [line.strip() for line in stdout.decode(errors="replace").splitlines() if "/" in line.strip()]
        return [HarnessModel(f"{self.name}//{model}", self.name, model.split("/", 1)[0], model) for model in models]


class CommandCodeAdapter(HarnessAdapter):
    name, display_name, executable, provider = "commandcode", "Command Code", "cmd", ""
    install_command = ["npm", "install", "-g", "command-code"]
    update_command = ["npm", "update", "-g", "command-code"]

    def build_command(self, prompt, model=None, session_id=None):
        command = [
            self.executable,
            "--print",
            prompt,
            "--output-format",
            "json",
            "--skip-onboarding",
            "--no-auto-update",
            "--permission-mode",
            "plan",
        ]
        if model and model != "default":
            command += ["--model", model]
        if session_id:
            command += ["--session", session_id]
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
        process = await asyncio.create_subprocess_exec(
            self.executable, "--list-models", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=30)
        if process.returncode != 0:
            return []
        model_ids = []
        for line in stdout.decode(errors="replace").splitlines():
            candidate = line.strip()
            match = re.match(r"^([\w./:-]+)\s{2,}", candidate)
            if match and not match.group(1).lower().startswith(("docs", "open", "available")):
                model_ids.append(match.group(1))
        return [
            HarnessModel(f"{self.name}//{model}", self.name, model.split("/", 1)[0] if "/" in model else None, model)
            for model in model_ids
        ]


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
    if name not in ADAPTERS:
        raise KeyError(f"Unknown harness: {name}")
    return ADAPTERS[name]


def all_adapters() -> list[HarnessAdapter]:
    return list(ADAPTERS.values())

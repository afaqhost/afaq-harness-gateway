import json
from pathlib import Path

from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel


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

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
            # tool call detection: {"tool": {"name":..., "id":..., "arguments":...}} or {"tool_call": {...}}
            tool = item.get("tool") or item.get("tool_call")
            if tool or item.get("type") == "tool_call" or item.get("type") == "function":
                # normalize tool_call
                if isinstance(tool, dict):
                    tc = tool
                elif isinstance(item.get("tool_call"), dict):
                    tc = item["tool_call"]
                else:
                    tc = item
                # ensure id and name
                tc_id = tc.get("id") or item.get("id") or f"call_{model.replace('/', '_')}_{abs(hash(line))%10000}"
                tc_name = tc.get("name") or tc.get("function", {}).get("name") or tc.get("tool") or "unknown"
                tc_args = tc.get("arguments") or tc.get("input") or tc.get("parameters") or {}
                # if arguments is string, keep as is, else dump
                if isinstance(tc_args, dict):
                    tc_args = tc_args
                normalized = {"id": str(tc_id), "type": "function", "function": {"name": str(tc_name), "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args) if isinstance(tc_args, dict) else str(tc_args)}}
                # also include raw tool for debugging
                return "", {"tool_call": normalized, "raw": item}
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

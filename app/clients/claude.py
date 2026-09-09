import json

from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel


class ClaudeAdapter(HarnessAdapter):
    name, display_name, executable, provider = "claude", "Claude Code", "claude", ""
    install_command = ["npm", "install", "-g", "@anthropic-ai/claude-code"]
    update_command = ["npm", "update", "-g", "@anthropic-ai/claude-code"]

    def build_command(self, prompt, model=None, session_id=None):
        command = [self.executable, "-p", prompt, "--output-format", "stream-json", "--permission-mode", "plan"]
        if model and model != "default":
            command += ["--model", model]
        if session_id:
            command += ["--resume", session_id]
        return command

    def parse_line(self, line, model):
        try:
            item = json.loads(line)
            # check for tool_use in stream-json (content_block_delta with tool_use)
            # typical: {"type":"content_block_delta","delta":{"type":"tool_use","id":"...","name":"...","input":{}}}
            delta = item.get("delta") or {}
            if item.get("type") == "content_block_delta" and delta.get("type") == "tool_use":
                tc_id = delta.get("id") or item.get("id") or f"call_{abs(hash(line))%10000}"
                tc_name = delta.get("name") or delta.get("tool") or "unknown"
                tc_args = delta.get("input") or delta.get("partial_json") or {}
                normalized = {"id": str(tc_id), "type": "function", "function": {"name": str(tc_name), "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args) if isinstance(tc_args, dict) else str(tc_args)}}
                return "", {"tool_call": normalized, "raw": item}
            # also direct tool call
            if item.get("type") == "tool_call" or item.get("tool"):
                tool = item.get("tool") or item.get("tool_call") or item
                tc_id = tool.get("id", f"call_{abs(hash(line))%10000}") if isinstance(tool, dict) else f"call_{abs(hash(line))%10000}"
                tc_name = tool.get("name", "unknown") if isinstance(tool, dict) else "unknown"
                tc_args = tool.get("arguments", {}) if isinstance(tool, dict) else {}
                normalized = {"id": str(tc_id), "type": "function", "function": {"name": str(tc_name), "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args) if isinstance(tc_args, dict) else str(tc_args)}}
                return "", {"tool_call": normalized, "raw": item}
        except json.JSONDecodeError:
            pass
        return line, {}

    async def list_models(self):
        if not self.is_installed():
            return []
        return [HarnessModel(f"claude//{m}", self.name, None, m) for m in ["default", "sonnet", "opus", "haiku"]]

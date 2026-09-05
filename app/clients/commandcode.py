import asyncio
import json
import re

from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel


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
            # tool_call detection: type tool_call or event.type tool_call or contains tool
            if item.get("type") == "tool_call" or event.get("type") == "tool_call" or item.get("tool") or event.get("tool") or item.get("tool_call"):
                # find inner tool dict
                inner = None
                if item.get("type") == "tool_call":
                    inner = item.get("tool") or item.get("tool_call") or item
                elif event.get("type") == "tool_call":
                    inner = event.get("tool") or event.get("tool_call") or event
                else:
                    inner = item.get("tool") or event.get("tool") or item.get("tool_call") or event.get("tool_call") or item
                # inner should be dict with name/id
                if not isinstance(inner, dict):
                    inner = item
                tc_id = inner.get("id") or item.get("id") or f"call_{abs(hash(line))%10000}"
                tc_name = inner.get("name") or "unknown"
                if isinstance(inner.get("function"), dict):
                    tc_name = inner["function"].get("name", tc_name)
                    tc_args = inner["function"].get("arguments", {})
                else:
                    tc_args = inner.get("arguments") or inner.get("input") or inner.get("parameters") or {}
                normalized = {"id": str(tc_id), "type": "function", "function": {"name": str(tc_name), "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args) if isinstance(tc_args, dict) else str(tc_args)}}
                return "", {"tool_call": normalized, "raw": item}
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

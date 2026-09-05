import asyncio
import json

from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel


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

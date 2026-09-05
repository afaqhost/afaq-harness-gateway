from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel


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

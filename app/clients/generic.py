from app.clients.base import HarnessAdapter


class GenericAdapter(HarnessAdapter):
    def __init__(self, name: str, executable: str, provider: str = "", command_template: list[str] | None = None):
        self.name, self.display_name, self.executable, self.provider = name, name, executable, provider
        self.command_template = command_template or [executable, "{prompt}"]

    def build_command(self, prompt, model=None, session_id=None):
        return [part.replace("{prompt}", prompt).replace("{model}", model or "default") for part in self.command_template]

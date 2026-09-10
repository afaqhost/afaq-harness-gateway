from dataclasses import dataclass

from app.clients.base import HarnessAdapter


@dataclass(frozen=True)
class GenericAdapterConfig:
    name: str
    executable: str
    provider: str = ""
    command_template: list[str] | None = None
    display_name: str | None = None
    install_command: list[str] | None = None
    update_command: list[str] | None = None


class GenericAdapter(HarnessAdapter):
    def __init__(
        self,
        config: GenericAdapterConfig | None = None,
        name: str | None = None,
        executable: str | None = None,
        provider: str = "",
        command_template: list[str] | None = None,
        display_name: str | None = None,
        install_command: list[str] | None = None,
        update_command: list[str] | None = None,
    ):
        if config is None:
            if name is None or executable is None:
                raise TypeError("GenericAdapter requires config or name+executable")
            config = GenericAdapterConfig(
                name=name,
                executable=executable,
                provider=provider,
                command_template=command_template,
                display_name=display_name,
                install_command=install_command,
                update_command=update_command,
            )
        elif isinstance(config, str):
            config = GenericAdapterConfig(
                name=config,
                executable=executable or config,
                provider=provider,
                command_template=command_template,
                display_name=display_name,
                install_command=install_command,
                update_command=update_command,
            )
        self.name = config.name
        self.display_name = config.display_name or config.name
        self.executable = config.executable
        self.provider = config.provider
        self.command_template = config.command_template or [config.executable, "{prompt}"]
        if config.install_command is not None:
            self.install_command = config.install_command
        if config.update_command is not None:
            self.update_command = config.update_command

    @classmethod
    def from_params(
        cls,
        name: str,
        executable: str,
        provider: str = "",
        command_template: list[str] | None = None,
        display_name: str | None = None,
        install_command: list[str] | None = None,
        update_command: list[str] | None = None,
    ) -> "GenericAdapter":
        return cls(
            GenericAdapterConfig(
                name=name,
                executable=executable,
                provider=provider,
                command_template=command_template,
                display_name=display_name,
                install_command=install_command,
                update_command=update_command,
            )
        )

    def build_command(self, prompt, model=None, session_id=None):
        return [part.replace("{prompt}", prompt).replace("{model}", model or "default") for part in self.command_template]

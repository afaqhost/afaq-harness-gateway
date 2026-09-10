import asyncio
import json

from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel


class PiAdapter(HarnessAdapter):
    name, display_name, executable, provider = "pi", "Pi Coding Agent", "pi", "pi"
    install_command = ["npm", "install", "-g", "pi"]
    update_command = ["npm", "update", "-g", "pi"]

    def build_command(self, prompt, model=None, session_id=None):
        # pi usage: pi -p "prompt" --mode json [--model provider/model] [--session ...] [--tools read,grep,find,ls] for plan
        # Use --mode json for structured output so parse_line can extract text_delta.
        # Keep default model (ollama qwen) when model==default to avoid requiring provider.
        command = [self.executable, "-p", prompt, "--mode", "json"]
        if model and model != "default":
            # pi expects --model <pattern> (provider/model or bare) - use provided model as is
            command += ["--model", model]
        if session_id:
            command += ["--session", session_id]
        return command

    def parse_line(self, line, model):
        try:
            item = json.loads(line)
            # pi JSON events:
            # {"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"..."}} => text
            # {"type":"message_start",...} , {"type":"agent_end",...}
            # tool_call detection: pi may emit tool call as {"type":"tool_call", "tool":{...}} or via message content tool
            # Check tool first
            if item.get("type") == "tool_call" or item.get("tool") or (isinstance(item.get("part"), dict) and item["part"].get("tool")):
                tool = item.get("tool") or (item.get("part") or {}).get("tool") or item.get("tool_call") or item
                if isinstance(tool, dict):
                    tc_id = tool.get("id") or item.get("id") or f"call_{abs(hash(line))%10000}"
                    tc_name = tool.get("name") or tool.get("tool") or (tool.get("function") or {}).get("name") or "unknown"
                    tc_args = tool.get("arguments") or tool.get("input") or tool.get("parameters") or {}
                    normalized = {"id": str(tc_id), "type": "function", "function": {"name": str(tc_name), "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args) if isinstance(tc_args, dict) else str(tc_args)}}
                    return "", {"tool_call": normalized, "raw": item}
                else:
                    return "", {"tool_call": {"id": f"call_{abs(hash(line))%10000}", "type": "function", "function": {"name": str(tool), "arguments": "{}"}}, "raw": item}
            # text extraction from pi events
            # assistantMessageEvent text_delta
            ame = item.get("assistantMessageEvent") or {}
            if isinstance(ame, dict) and ame.get("type") == "text_delta":
                return ame.get("delta") or "", item
            if isinstance(ame, dict) and ame.get("type") == "text_start":
                return "", item
            if item.get("type") in ("session", "agent_start", "turn_start", "message_start", "message_end", "turn_end", "agent_end", "agent_settled"):
                # session lifecycle events - no text to stream (message_end may contain final content but we already streamed deltas)
                return "", item
            # fallback text fields
            text = item.get("text") or item.get("content") or ""
            # if content is list of parts (like OpenAI)
            if isinstance(text, list):
                # join text parts
                txt = ""
                for part in text:
                    if isinstance(part, dict) and part.get("type") == "text":
                        txt += part.get("text", "")
                return txt, item
            return text or "", item
        except json.JSONDecodeError:
            return line, {}

    def parse_output(self, output: bytes, model: str) -> str:
        # output is NDJSON; coalesce text_delta deltas, else final assistant message content
        decoded = output.decode(errors="replace")
        parts = []
        final_content = None
        for line in decoded.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                ame = item.get("assistantMessageEvent") or {}
                if isinstance(ame, dict) and ame.get("type") == "text_delta":
                    parts.append(ame.get("delta", ""))
                elif item.get("type") == "agent_end" and isinstance(item.get("messages"), list):
                    # last assistant message
                    for msg in reversed(item["messages"]):
                        if msg.get("role") == "assistant" and isinstance(msg.get("content"), list):
                            for c in msg["content"]:
                                if c.get("type") == "text":
                                    final_content = c.get("text", "")
                                    break
                elif item.get("type") == "message_end" and isinstance(item.get("message"), dict):
                    m = item["message"]
                    if m.get("role") == "assistant" and isinstance(m.get("content"), list):
                        for c in m["content"]:
                            if c.get("type") == "text":
                                final_content = c.get("text", "") if not final_content else final_content
            except json.JSONDecodeError:
                parts.append(line)
        if parts:
            joined = "".join(parts).strip()
            if joined:
                return joined
        if final_content:
            return final_content.strip()
        # fallback to generic line concatenation
        return "".join(self.parse_line(line, model)[0] for line in decoded.splitlines()).strip()

    async def list_models(self):
        if not self.is_installed():
            return []
        try:
            proc = await asyncio.create_subprocess_exec(
                self.executable, "--list-models", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            if proc.returncode != 0:
                return []
            models = []
            for line in stdout.decode(errors="replace").splitlines():
                line = line.strip()
                if not line or line.lower().startswith("provider"):
                    continue
                # table: provider<spaces>model<spaces>...
                # split by whitespace, second column is model name
                parts = line.split()
                if len(parts) >= 2:
                    provider = parts[0]
                    model_name = parts[1]
                    # combine as provider/model for uniqueness
                    full = f"{provider}/{model_name}" if "/" not in model_name else model_name
                    models.append(full)
            # deduplicate and cap
            seen = set()
            uniq = []
            for m in models:
                if m not in seen:
                    seen.add(m)
                    uniq.append(m)
            # limit to 30 to avoid huge cache
            uniq = uniq[:30]
            return [HarnessModel(f"{self.name}//{m}", self.name, m.split("/")[0] if "/" in m else None, m) for m in uniq]
        except (OSError, asyncio.TimeoutError):
            return []

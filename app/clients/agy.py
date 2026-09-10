import asyncio
import json

from app.clients.base import HarnessAdapter
from app.models.harness import HarnessModel


class AgyAdapter(HarnessAdapter):
    name, display_name, executable, provider = "agy", "Google Antigravity", "agy", "google"
    install_command = ["npm", "install", "-g", "@google/agy"]
    update_command = ["npm", "update", "-g", "@google/agy"]

    def build_command(self, prompt, model=None, session_id=None):
        # agy uses --print=<prompt> (equals form avoids --help confusion) and --output-format json/stream-json.
        # Use json for non-stream coalescing; streaming still works via line JSON.
        # --mode plan enforces read-only plan mode.
        command = [self.executable, f"--print={prompt}", "--output-format", "json", "--mode", "plan"]
        if model and model != "default":
            command += ["--model", model]
        if session_id:
            command += ["--resume", session_id]
        return command

    def parse_line(self, line, model):
        try:
            item = json.loads(line)
            # agy stream-json shapes: {"event":"init"...}, {"event":"result","result":{"response":...}},
            # or tool_call: {"type":"tool_call","tool":{"name":...}} or {"tool":{...}}
            # handle tool
            tool = item.get("tool") or item.get("tool_call")
            evt = item.get("event") or {}
            # event-level tool
            if isinstance(evt, dict) and (evt.get("type") == "tool_call" or evt.get("tool")):
                tool = evt.get("tool") or evt.get("tool_call") or tool
                if isinstance(tool, dict):
                    tc_id = tool.get("id") or item.get("id") or f"call_{abs(hash(line))%10000}"
                    tc_name = tool.get("name") or tool.get("tool") or "unknown"
                    tc_args = tool.get("arguments") or tool.get("input") or tool.get("parameters") or {}
                    normalized = {"id": str(tc_id), "type": "function", "function": {"name": str(tc_name), "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args) if isinstance(tc_args, dict) else str(tc_args)}}
                    return "", {"tool_call": normalized, "raw": item}
            if tool or item.get("type") == "tool_call" or item.get("type") == "function":
                if isinstance(tool, dict):
                    tc = tool
                elif isinstance(item.get("tool_call"), dict):
                    tc = item["tool_call"]
                else:
                    tc = item
                tc_id = tc.get("id") or item.get("id") or f"call_{abs(hash(line))%10000}"
                tc_name = tc.get("name") or tc.get("function", {}).get("name") or tc.get("tool") or "unknown"
                tc_args = tc.get("arguments") or tc.get("input") or tc.get("parameters") or {}
                normalized = {"id": str(tc_id), "type": "function", "function": {"name": str(tc_name), "arguments": tc_args if isinstance(tc_args, str) else json.dumps(tc_args) if isinstance(tc_args, dict) else str(tc_args)}}
                return "", {"tool_call": normalized, "raw": item}
            # text extraction: result.response or text fields
            if isinstance(item.get("result"), dict):
                res = item["result"]
                text = res.get("response") or res.get("text") or ""
                if text:
                    return text, item
            # init event has no text
            if item.get("event") == "init":
                return "", item
            if item.get("event") == "result":
                # already handled result.response; if no response, suppress to avoid dup
                return "", item
            text = item.get("text") or item.get("content") or item.get("response") or ""
            return text, item
        except json.JSONDecodeError:
            return line, {}

    def parse_output(self, output: bytes, model: str) -> str:
        # output may be single JSON with result.response or NDJSON lines
        decoded = output.decode(errors="replace").strip()
        if not decoded:
            return ""
        # try single JSON with result.response
        try:
            obj = json.loads(decoded)
            if isinstance(obj, dict) and isinstance(obj.get("result"), dict):
                resp = obj["result"].get("response")
                if resp:
                    return resp.strip()
        except json.JSONDecodeError:
            pass
        # fallback: concatenate parse_line texts
        parts = []
        for line in decoded.splitlines():
            txt, _ = self.parse_line(line, model)
            if txt:
                parts.append(txt)
        joined = "".join(parts).strip()
        return joined or decoded

    _FALLBACK_MODELS = [
        "gemini-3.8-flash-high",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-low",
        "gemini-3.7-flash-high",
        "gemini-3.7-flash-medium",
        "gemini-3.7-flash-low",
        "gemini-3.6-flash-high",
        "gemini-3.6-flash-medium",
        "gemini-3.6-flash-low",
        "gemini-3.1-pro-high",
        "gemini-3.1-pro-low",
        "claude-sonnet-4-6",
        "claude-opus-4-6-thinking",
        "gpt-oss-120b-medium",
    ]

    async def list_models(self):
        if not self.is_installed():
            return []
        try:
            proc = await asyncio.create_subprocess_exec(
                self.executable, "models", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=4)
            if proc.returncode != 0:
                raise RuntimeError(f"agy models exit {proc.returncode}")
            models = []
            for line in stdout.decode(errors="replace").splitlines():
                line = line.strip()
                if not line or line.lower().startswith("fetching"):
                    continue
                first = line.split()[0].split("\t")[0].strip()
                if first:
                    models.append(first)
            seen = set()
            uniq = []
            for m in models:
                if m not in seen:
                    seen.add(m)
                    uniq.append(m)
            if uniq:
                return [HarnessModel(f"{self.name}//{m}", self.name, m.split("/")[0] if "/" in m else None, m) for m in uniq]
        except (OSError, asyncio.TimeoutError, RuntimeError):
            pass
        # fallback static list ensures health/model discovery never blocks on network
        return [HarnessModel(f"{self.name}//{m}", self.name, None, m) for m in self._FALLBACK_MODELS]

const ENV_ALLOWLIST = ["HOME", "PATH", "USER", "SHELL", "LANG", "LC_ALL", "TMPDIR"];

export function buildMinimalEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  if (extra) {
    for (const [key, val] of Object.entries(extra)) {
      if (val !== undefined) env[key] = val;
    }
  }
  return env;
}

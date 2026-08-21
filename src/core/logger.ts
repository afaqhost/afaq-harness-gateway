type LogLevel = "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

const SECRET_PATTERNS: RegExp[] = [
  /authorization\s*[:=]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /ahg_live_[A-Za-z0-9_-]+/gi,
  /(api[_-]?key|apikey|secret|token|password)\s*[:=]\s*\S+/gi,
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function write(level: LogLevel, message: string, fields: LogFields): void {
  const safeFields: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    safeFields[key] = typeof value === "string" ? redactSecrets(value) : value;
  }
  const line = JSON.stringify({ level, message, ...safeFields, ts: new Date().toISOString() });
  process.stderr.write(line + "\n");
}

export const logger = {
  info(message: string, fields: LogFields = {}): void {
    write("info", message, fields);
  },
  warn(message: string, fields: LogFields = {}): void {
    write("warn", message, fields);
  },
  error(message: string, fields: LogFields = {}): void {
    write("error", message, fields);
  },
};

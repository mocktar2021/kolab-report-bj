// Server log lines (KRB-138): one JSON object per line, { level, msg, time,
// requestId, ...fields }, so Vercel's logs and any drain behind them can
// search them (docs/operations/monitoring.md). No imports: the parse worker
// (scripts/build-parse-worker.mjs) bundles this file, and the edge runtime
// can load it.

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type Logger = Record<LogLevel, (msg: string, fields?: LogFields) => void>;

/**
 * Text under these keys never reaches the logs: secrets, e-mails and report
 * text. The match is loose on purpose, so `userEmail`, `refresh_token` or
 * `parsed_content` are hidden too. Numbers and booleans stay, so token
 * counts such as `outputTokens` still show.
 */
const SENSITIVE_KEY =
  /e-?mail|passw|token|secret|authori[sz]ation|cookie|api[-_]?key|content|prompt|output|markdown/i;

const EMAIL = /[\w.+%-]+@[\w-]+(?:\.[\w-]+)+/g;

const REDACTED = "[redacted]";

/** Values nested deeper than this show as "[nested]". */
const MAX_DEPTH = 6;

/** The line keeps these whatever the fields hold. */
const LINE_KEYS = new Set(["level", "msg", "time", "requestId"]);

export function maskEmails(text: string): string {
  return text.replace(EMAIL, "[email]");
}

function cleanFields(fields: object, depth: number, seen: Set<object>): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    const countOrFlag = typeof value === "number" || typeof value === "boolean" || value == null;
    out[key] = SENSITIVE_KEY.test(key) && !countOrFlag ? REDACTED : clean(value, depth, seen);
  }
  return out;
}

function clean(value: unknown, depth: number, seen: Set<object>): unknown {
  if (typeof value === "string") return maskEmails(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (ArrayBuffer.isView(value)) return `[${value.byteLength} bytes]`;
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[nested]";
  seen.add(value);
  try {
    // Only the name, message and stack of an error: SDK errors carry the
    // request they failed on, prompt included, in their other properties.
    if (value instanceof Error) {
      const error: LogFields = { name: value.name, message: maskEmails(value.message) };
      if (value.stack) error.stack = maskEmails(value.stack);
      if (value.cause !== undefined) error.cause = clean(value.cause, depth + 1, seen);
      return error;
    }
    if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1, seen));
    return cleanFields(value, depth + 1, seen);
  } finally {
    seen.delete(value);
  }
}

/** The fields as they reach the logs: sensitive keys hidden, e-mails masked, errors cut down. */
export function redact(fields: LogFields): LogFields {
  return cleanFields(fields, 0, new Set());
}

function toLine(level: LogLevel, msg: string, time: string, requestId: string | null, safe: LogFields) {
  const line: LogFields = { level, msg: maskEmails(msg), time, requestId };
  for (const [key, value] of Object.entries(safe)) {
    if (!LINE_KEYS.has(key)) line[key] = value;
  }
  return JSON.stringify(line);
}

/** One log line, as the logger writes it. */
export function formatLogLine(
  level: LogLevel,
  msg: string,
  fields: LogFields = {},
  { time = new Date().toISOString(), requestId = null }: { time?: string; requestId?: string | null } = {},
): string {
  return toLine(level, msg, time, requestId, redact(fields));
}

function write(level: LogLevel, line: string) {
  // stdout for info and warn, stderr for errors, in Node.js and on the edge alike.
  if (level === "error") console.error(line);
  else console.log(line);
}

/**
 * A logger whose lines carry the id `requestId` returns. When the id comes
 * as a promise, the line is written once it is known, with the time of the
 * call. Logging never throws.
 */
export function createLogger(requestId: () => string | null | Promise<string | null>): Logger {
  function emit(level: LogLevel, msg: string, fields: LogFields = {}) {
    try {
      const time = new Date().toISOString();
      // Cleaned now, so a later change to the fields cannot reach the line.
      const safe = redact(fields);
      const output = (id: string | null) => {
        try {
          write(level, toLine(level, msg, time, id, safe));
        } catch {
          // Nowhere left to write to.
        }
      };
      let id: string | null | Promise<string | null>;
      try {
        id = requestId();
      } catch {
        id = null;
      }
      if (id instanceof Promise) id.then(output, () => output(null));
      else output(id);
    } catch {
      // A log line is never worth failing the request for.
    }
  }

  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}

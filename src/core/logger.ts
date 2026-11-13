export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SCOPES = ["server", "api", "nvr", "thumbnails", "clips", "live", "storage"] as const;
export type LogScope = (typeof LOG_SCOPES)[number];

export type LogValue = string | number | boolean | null;

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  scope: LogScope;
  message: string;
  fields: Record<string, LogValue>;
}

export type NewLogEntry = Omit<LogEntry, "id">;

interface LogContext {
  scope?: LogScope;
  [field: string]: unknown;
}

export interface Logger {
  log(input: LogContext & { level: LogLevel; message: string }): void;
  with(context: LogContext): Logger;
}

function logValue(value: unknown): LogValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Error) return value.message;
  return JSON.stringify(value) ?? String(value);
}

function line(entry: NewLogEntry): string {
  const fields = Object.entries(entry.fields).map(
    ([key, value]) => `${key}=${typeof value === "string" && !/[\s"=]/.test(value) ? value : JSON.stringify(value)}`
  );
  return [
    new Date(entry.ts).toISOString().slice(11, 19),
    entry.level.padEnd(5),
    entry.scope.padEnd(10),
    entry.message,
    ...fields,
  ].join(" ");
}

// persist must not be trusted to succeed: at shutdown the database closes while
// in-flight work is still logging.
export function createLogger(persist: ((entry: NewLogEntry) => void) | null, bound: LogContext = {}): Logger {
  return {
    log: ({ level, message, scope, ...rest }) => {
      const fields: Record<string, LogValue> = {};
      for (const [key, value] of Object.entries({ ...bound, ...rest })) {
        const normalized = key === "scope" ? undefined : logValue(value);
        if (normalized !== undefined) fields[key] = normalized;
      }
      const entry: NewLogEntry = { ts: Date.now(), level, scope: scope ?? bound.scope ?? "server", message, fields };
      console.log(line(entry));
      try {
        persist?.(entry);
      } catch {}
    },
    with: context => createLogger(persist, { ...bound, ...context }),
  };
}

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

export function createLogger(write: (entry: NewLogEntry) => void, bound: LogContext = {}): Logger {
  return {
    log: ({ level, message, scope, ...rest }) => {
      const fields: Record<string, LogValue> = {};
      for (const [key, value] of Object.entries({ ...bound, ...rest })) {
        const normalized = key === "scope" ? undefined : logValue(value);
        if (normalized !== undefined) fields[key] = normalized;
      }
      write({ ts: Date.now(), level, scope: scope ?? bound.scope ?? "server", message, fields });
    },
    with: context => createLogger(write, { ...bound, ...context }),
  };
}

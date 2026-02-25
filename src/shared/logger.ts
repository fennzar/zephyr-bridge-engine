import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type StructuredLogEntry = {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  meta?: Record<string, unknown>;
};

export type Logger = {
  debug(message?: unknown, ...rest: unknown[]): void;
  info(message?: unknown, ...rest: unknown[]): void;
  warn(message?: unknown, ...rest: unknown[]): void;
  error(message?: unknown, ...rest: unknown[]): void;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const activeLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

function isEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[activeLevel];
}

// ---------------------------------------------------------------------------
// Project root resolution
// ---------------------------------------------------------------------------

export function resolveProjectRoot(): string {
  let current = process.cwd();
  let candidate = current;
  while (true) {
    const pkgPath = join(current, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const content = readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(content) as { name?: string };
        if (pkg?.name === "zephyr-bot") {
          return current;
        }
        candidate = current;
      } catch {
        candidate = current;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      return candidate;
    }
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// Optional file logging (activated by LOG_DIR env var)
// ---------------------------------------------------------------------------

type Writable = { write(data: string): boolean };

let sharedStream: Writable | null = null;

function getStream(): Writable | null {
  const logDir = process.env.LOG_DIR;
  if (!logDir) return null;
  if (sharedStream) return sharedStream;

  try {
    const rfs = require("rotating-file-stream") as typeof import("rotating-file-stream");
    const dir = resolve(process.env.PROJECT_ROOT ?? resolveProjectRoot(), logDir);
    mkdirSync(dir, { recursive: true });

    const fileName = process.env.LOG_FILE ?? "app.log";
    sharedStream = rfs.createStream(fileName, {
      size: (process.env.LOG_ROTATE_SIZE ?? "5M") as import("rotating-file-stream").Options["size"],
      maxFiles: Number(process.env.LOG_ROTATE_FILES ?? 5),
      path: dir,
      compress: (process.env.LOG_COMPRESS ?? "gzip") as import("rotating-file-stream").Options["compress"],
    });
    return sharedStream;
  } catch {
    // rotating-file-stream may not be available (e.g. in browser builds)
    return null;
  }
}

function writeLog(entry: StructuredLogEntry): void {
  const stream = getStream();
  if (stream) {
    stream.write(`${JSON.stringify(entry)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

function logWithLevel(level: LogLevel, scope: string, message: unknown, metaParts: unknown[]) {
  if (!isEnabled(level)) return;

  const meta = metaParts.length > 0 ? { args: metaParts } : undefined;
  const normalized =
    typeof message === "string"
      ? message
      : message instanceof Error
        ? message.message
        : JSON.stringify(message);

  const entry: StructuredLogEntry = {
    ts: new Date().toISOString(),
    level,
    scope,
    message: normalized,
    ...(meta ? { meta } : {}),
  };

  writeLog(entry);

  const consoleTarget =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (metaParts.length > 0) {
    consoleTarget(`[${scope}] ${normalized}`, ...metaParts);
  } else {
    consoleTarget(`[${scope}] ${normalized}`);
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug(message?: unknown, ...rest: unknown[]) {
      logWithLevel("debug", scope, message, rest);
    },
    info(message?: unknown, ...rest: unknown[]) {
      logWithLevel("info", scope, message, rest);
    },
    warn(message?: unknown, ...rest: unknown[]) {
      logWithLevel("warn", scope, message, rest);
    },
    error(message?: unknown, ...rest: unknown[]) {
      logWithLevel("error", scope, message, rest);
    },
  };
}

// ---------------------------------------------------------------------------
// Log file reading (for dashboard / status endpoints)
// ---------------------------------------------------------------------------

export function getLogFilePath(): string {
  const logDir = process.env.LOG_DIR;
  if (!logDir) return "";
  const root = process.env.PROJECT_ROOT ?? resolveProjectRoot();
  return join(resolve(root, logDir), process.env.LOG_FILE ?? "app.log");
}

export function readRecentLogs(limit = 100): StructuredLogEntry[] {
  const logPath = getLogFilePath();
  if (!logPath || !existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf8");
  const lines = raw.trim().split("\n");
  const slice = lines.slice(-limit);
  return slice
    .map((line) => {
      try {
        return JSON.parse(line) as StructuredLogEntry;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is StructuredLogEntry => Boolean(entry));
}

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { LogEntry, LogLevel, LogScope, NewLogEntry } from "../core/logger.js";

const READ_CHUNK = 256 * 1024;
const FILE = /^watchtower-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

async function* linesBackward(file: string): AsyncGenerator<string> {
  const handle = await fsp.open(file, "r");
  try {
    let position = (await handle.stat()).size;
    let carry = Buffer.alloc(0);
    while (position > 0) {
      const size = Math.min(READ_CHUNK, position);
      position -= size;
      const chunk = Buffer.alloc(size);
      await handle.read(chunk, 0, size, position);
      const buffer = Buffer.concat([chunk, carry]);
      let end = buffer.length;
      // lastIndexOf treats a negative offset as counting from the end, so stop at 0.
      let newline = buffer.lastIndexOf(0x0a, end - 1);
      while (newline !== -1) {
        if (end > newline + 1) yield buffer.toString("utf8", newline + 1, end);
        end = newline;
        newline = end === 0 ? -1 : buffer.lastIndexOf(0x0a, end - 1);
      }
      carry = buffer.subarray(0, end);
    }
    if (carry.length > 0) yield carry.toString("utf8");
  } finally {
    await handle.close();
  }
}

export class LogFiles {
  private stream: fs.WriteStream | null = null;
  private day: string | null = null;
  private lastId = 0;
  private closed = false;

  constructor(private readonly opts: { dir: string; retentionDays: number }) {
    fs.mkdirSync(opts.dir, { recursive: true });
  }

  write(entry: NewLogEntry): void {
    if (this.closed) return;
    const day = utcDay(entry.ts);
    if (day !== this.day || this.stream === null) {
      this.stream?.end();
      this.stream = fs.createWriteStream(path.join(this.opts.dir, `watchtower-${day}.jsonl`), { flags: "a" });
      // A failed write (disk full, missing directory) must not crash the server.
      this.stream.on("error", () => undefined);
      this.day = day;
    }
    this.lastId = Math.max(this.lastId + 1, entry.ts * 1000);
    this.stream.write(`${JSON.stringify({ id: this.lastId, ...entry })}\n`);
  }

  async query(filter: {
    levels: readonly LogLevel[];
    scope: LogScope | null;
    text: string | null;
    before: number | null;
    after: number | null;
    limit: number;
  }): Promise<LogEntry[]> {
    const needle = filter.text?.toLowerCase() ?? null;
    const levelMarks = filter.levels.map(level => `"level":"${level}"`);
    const scopeMark = filter.scope === null ? null : `"scope":"${filter.scope}"`;
    const out: LogEntry[] = [];
    for (const file of (await this.files()).reverse()) {
      const day = FILE.exec(file)?.[1] ?? "";
      if (filter.before !== null && day > utcDay(filter.before / 1000)) continue;
      if (filter.after !== null && day < utcDay(filter.after / 1000)) break;
      for await (const line of linesBackward(path.join(this.opts.dir, file))) {
        // Cheap string checks first: a full scan parses only the lines that can match.
        const id = Number(/^\{"id":(\d+),/.exec(line)?.[1]);
        if (filter.after !== null && id <= filter.after) return out;
        if (filter.before !== null && id >= filter.before) continue;
        if (!levelMarks.some(mark => line.includes(mark))) continue;
        if (scopeMark !== null && !line.includes(scopeMark)) continue;
        if (needle !== null && !line.toLowerCase().includes(needle)) continue;
        let entry: LogEntry;
        try {
          entry = JSON.parse(line) as LogEntry;
        } catch {
          continue;
        }
        if (!filter.levels.includes(entry.level)) continue;
        if (filter.scope !== null && entry.scope !== filter.scope) continue;
        if (needle !== null && !`${entry.message} ${JSON.stringify(entry.fields)}`.toLowerCase().includes(needle)) {
          continue;
        }
        out.push(entry);
        if (out.length === filter.limit) return out;
      }
    }
    return out;
  }

  async prune(now: number): Promise<void> {
    const cutoff = utcDay(now - this.opts.retentionDays * 86_400_000);
    for (const file of await this.files()) {
      const day = FILE.exec(file)?.[1];
      if (day !== undefined && day < cutoff) await fsp.rm(path.join(this.opts.dir, file), { force: true });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const stream = this.stream;
    this.stream = null;
    if (stream) await new Promise<void>(resolve => stream.end(resolve));
  }

  private async files(): Promise<string[]> {
    return (await fsp.readdir(this.opts.dir)).filter(file => FILE.test(file)).sort();
  }
}

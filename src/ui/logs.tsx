import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import type { LogLevel, LogScope } from "../core/logger.js";
import { type ApiResponse, api } from "./api.js";
import { setSearchParam, useSearchParam } from "./router.js";
import { stamp } from "./time.js";
import { useDebounced } from "./use-debounced.js";

type LogEntry = ApiResponse<"/api/logs", "GET">["entries"][number];

const LEVELS: Record<LogLevel, { filter: string; badge: "outline" | "warning" | "destructive" }> = {
  info: { filter: "All levels", badge: "outline" },
  warn: { filter: "Warnings and errors", badge: "warning" },
  error: { filter: "Errors only", badge: "destructive" },
};

const SCOPES: Record<LogScope, string> = {
  server: "Server",
  api: "API",
  nvr: "NVR",
  thumbnails: "Thumbnails",
  clips: "Clips",
  live: "Live",
  storage: "Storage",
};

// Radix Select forbids empty-string item values, so "every scope" uses a
// sentinel that maps back to scope === null.
const ALL_SCOPES = "__all__";

const PAGE_SIZE = 200;
const REFRESH_MS = 5_000;

const isLevel = (value: string): value is LogLevel => Object.hasOwn(LEVELS, value);
const isScope = (value: string): value is LogScope => Object.hasOwn(SCOPES, value);

function useLogs(level: LogLevel, scope: LogScope | null, text: string | null) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signal = useRef<AbortSignal | null>(null);
  const query = { level, scope: scope ?? undefined, q: text ?? undefined, limit: PAGE_SIZE };

  useEffect(() => {
    const controller = new AbortController();
    signal.current = controller.signal;
    const fetchNewest = async (first: boolean): Promise<void> => {
      if (!first && document.hidden) return;
      try {
        const { entries: newest } = await api("/api/logs", "GET", { query, signal: controller.signal });
        setError(null);
        if (first) setHasOlder(newest.length === PAGE_SIZE);
        const oldestNew = newest.at(-1)?.id ?? 0;
        setEntries(previous =>
          first || previous === null ? newest : [...newest, ...previous.filter(entry => entry.id < oldestNew)]
        );
      } catch (failure) {
        if (!controller.signal.aborted) setError(String(failure));
      }
    };
    setEntries(null);
    void fetchNewest(true);
    const timer = setInterval(() => void fetchNewest(false), REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [level, scope, text]);

  const loadOlder = async (): Promise<void> => {
    const before = entries?.at(-1)?.id;
    const current = signal.current;
    if (before === undefined || current === null) return;
    setLoadingOlder(true);
    try {
      const { entries: older } = await api("/api/logs", "GET", { query: { ...query, before }, signal: current });
      setEntries(previous => [...(previous ?? []), ...older]);
      setHasOlder(older.length === PAGE_SIZE);
    } catch (failure) {
      if (!current.aborted) setError(String(failure));
    } finally {
      setLoadingOlder(false);
    }
  };

  return { entries, hasOlder, loadingOlder, error, loadOlder };
}

export function LogsPage() {
  const levelParam = useSearchParam("level");
  const scopeParam = useSearchParam("scope");
  const search = useSearchParam("q");
  const level = isLevel(levelParam) ? levelParam : "info";
  const scope = isScope(scopeParam) ? scopeParam : null;
  const text = useDebounced(search.trim(), 300) || null;
  const { entries, hasOlder, loadingOlder, error, loadOlder } = useLogs(level, scope, text);

  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Logs</h1>
        <Select
          value={level}
          onValueChange={value => setSearchParam("level", value === "info" ? null : value, "replace")}
        >
          <SelectTrigger aria-label="Level" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(LEVELS) as LogLevel[]).map(option => (
              <SelectItem key={option} value={option}>
                {LEVELS[option].filter}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={scope ?? ALL_SCOPES}
          onValueChange={value => setSearchParam("scope", value === ALL_SCOPES ? null : value, "replace")}
        >
          <SelectTrigger aria-label="Scope" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SCOPES}>All scopes</SelectItem>
            {(Object.keys(SCOPES) as LogScope[]).map(option => (
              <SelectItem key={option} value={option}>
                {SCOPES[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          aria-label="Search"
          placeholder="Search messages and fields"
          className="w-64"
          value={search}
          onChange={event => setSearchParam("q", event.target.value || null, "replace")}
        />
      </div>
      {error === null ? null : <p className="text-sm text-destructive">{error}</p>}
      {(() => {
        if (entries === null) {
          return null;
        } else if (entries.length === 0) {
          return <p className="py-24 text-center text-sm text-muted-foreground">No log entries match.</p>;
        } else {
          return <LogTable entries={entries} />;
        }
      })()}
      {hasOlder && entries !== null ? (
        <Button variant="outline" className="self-center" disabled={loadingOlder} onClick={() => void loadOlder()}>
          {loadingOlder ? "Loading…" : "Load older"}
        </Button>
      ) : null}
    </main>
  );
}

function LogTable({ entries }: { entries: LogEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">Time</TableHead>
          <TableHead className="w-20">Level</TableHead>
          <TableHead className="w-28">Scope</TableHead>
          <TableHead>Message</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map(entry => (
          <TableRow key={entry.id}>
            <TableCell className="align-top tabular-nums text-muted-foreground">{stamp(entry.ts)}</TableCell>
            <TableCell className="align-top">
              <Badge variant={LEVELS[entry.level].badge}>{entry.level}</Badge>
            </TableCell>
            <TableCell className="align-top text-muted-foreground">{SCOPES[entry.scope]}</TableCell>
            <TableCell className="whitespace-normal">
              <div>{entry.message}</div>
              <div className="flex flex-wrap gap-x-3 font-mono text-sm break-all text-muted-foreground">
                {Object.entries(entry.fields).map(([key, value]) => (
                  <span key={key}>
                    {key}={String(value)}
                  </span>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

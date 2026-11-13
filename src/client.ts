import type { WatchtowerApi } from "./api/routes.js";

export type { WatchtowerApi };

type Path = keyof WatchtowerApi & string;
type MethodOf<P extends Path> = keyof WatchtowerApi[P] & string;
type EndpointOf<P extends Path, M extends MethodOf<P>> = WatchtowerApi[P][M];

type Field<E, K extends string> = E extends Record<K, infer V> ? ([V] extends [never] ? never : V) : never;

type Options<E> = ([Field<E, "params">] extends [never] ? unknown : { params: Field<E, "params"> }) &
  ([Field<E, "query">] extends [never] ? unknown : { query: Field<E, "query"> }) &
  ([Field<E, "body">] extends [never] ? unknown : { body: Field<E, "body"> }) & { signal?: AbortSignal };

type Args<E> = [Field<E, "params"> | Field<E, "query"> | Field<E, "body">] extends [never]
  ? [options?: Options<E>]
  : [options: Options<E>];

/** Response body of `path` + `method`, for typing UI state from the API. */
export type Response<P extends Path, M extends MethodOf<P>> =
  EndpointOf<P, M> extends { response: infer R } ? R : never;

export class WatchtowerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/** @public */
export interface ClientOptions {
  /** Origin of the Watchtower server; "" for same-origin (the bundled UI). */
  baseUrl: string;
  /** Bearer key for /api/v1. */
  apiKey?: string;
  timeoutMs?: number;
  /** Called on any 401, before the request rejects. */
  onUnauthorized?: () => void;
}

export function createWatchtowerClient({ baseUrl, apiKey, timeoutMs = 10_000, onUnauthorized }: ClientOptions) {
  return async function request<P extends Path, M extends MethodOf<P>>(
    path: P,
    method: M,
    ...[options]: Args<EndpointOf<P, M>>
  ): Promise<Response<P, M>> {
    const { params, query, body, signal } = (options ?? {}) as {
      params?: Record<string, string>;
      query?: Record<string, unknown>;
      body?: unknown;
      signal?: AbortSignal;
    };
    let url = baseUrl + path.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params?.[key] ?? ""));
    if (query) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        search.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
      url += `?${search}`;
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    const response = await fetch(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.();
      const payload = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new WatchtowerError(
        response.status,
        payload?.error?.code ?? `http_${response.status}`,
        payload?.error?.message ?? `${method} ${path} → HTTP ${response.status}`
      );
    }
    return (await response.json()) as Response<P, M>;
  };
}

/** @public */
export type WatchtowerClient = ReturnType<typeof createWatchtowerClient>;

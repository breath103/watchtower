import type { WatchtowerApi } from "../api/routes.js";

type Path = keyof WatchtowerApi & string;
type MethodOf<P extends Path> = keyof WatchtowerApi[P] & string;
type EndpointOf<P extends Path, M extends MethodOf<P>> = WatchtowerApi[P][M];

type Field<E, K extends string> = E extends Record<K, infer V> ? ([V] extends [never] ? never : V) : never;

type Options<E> = ([Field<E, "params">] extends [never] ? unknown : { params: Field<E, "params"> }) &
  ([Field<E, "query">] extends [never] ? unknown : { query: Field<E, "query"> }) &
  ([Field<E, "body">] extends [never] ? unknown : { body: Field<E, "body"> }) & { signal?: AbortSignal };

export type ApiResponse<P extends Path, M extends MethodOf<P>> =
  EndpointOf<P, M> extends { response: infer R } ? R : never;

export const SIGNED_OUT = "watchtower:signed-out";

export async function api<P extends Path, M extends MethodOf<P>>(
  path: P,
  method: M,
  ...[options]: [Field<EndpointOf<P, M>, "params"> | Field<EndpointOf<P, M>, "query"> | Field<EndpointOf<P, M>, "body">] extends [never]
    ? [options?: Options<EndpointOf<P, M>>]
    : [options: Options<EndpointOf<P, M>>]
): Promise<ApiResponse<P, M>> {
  const { params, query, body, signal } = (options ?? {}) as {
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
    signal?: AbortSignal;
  };
  let url = path.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent(params?.[key] ?? ""));
  if (query) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      search.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
    url += `?${search}`;
  }
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(SIGNED_OUT));
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(payload?.error?.message ?? `${method} ${path} → HTTP ${response.status}`);
  }
  return (await response.json()) as ApiResponse<P, M>;
}

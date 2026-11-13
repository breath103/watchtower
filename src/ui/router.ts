import { useSyncExternalStore } from "react";

export const ROUTES = { cameras: "/", settings: "/settings" } as const;
export type Route = keyof typeof ROUTES;

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function navigate(route: Route): void {
  if (window.location.pathname + window.location.search === ROUTES[route]) return;
  window.history.pushState(null, "", ROUTES[route]);
  for (const listener of listeners) listener();
}

export function useSearchParam(name: string): string {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get(name) ?? "");
}

export function setSearchParam(name: string, value: string | null, mode: "push" | "replace" = "push"): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  if (url.href === window.location.href) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  for (const listener of listeners) listener();
}

export function useRoute(): Route {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname);
  const match = (Object.keys(ROUTES) as Route[]).find(route => ROUTES[route] === path);
  return match ?? "cameras";
}

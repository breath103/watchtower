// JSON routes declared once: zod schemas for input, the handler's return type
// for output. `ApiOf` turns a route list into the type every client uses
// (src/ui/api.ts, and other apps via the generated declarations), so no
// request/response type is written twice.

import type { Context, Hono } from "hono";
import { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
type Shape = Record<string, z.ZodType>;

type PathParams<T extends string> = T extends `${string}:${infer Param}/${infer Rest}`
  ? Param | PathParams<`/${Rest}`>
  : T extends `${string}:${infer Param}`
    ? Param
    : never;

type Simplify<T> = { [K in keyof T]: T[K] };
type InferShape<T> = [T] extends [never]
  ? never
  : Simplify<
      { [K in keyof T as undefined extends z.output<T[K] & z.ZodType> ? never : K]: z.output<T[K] & z.ZodType> } & {
        [K in keyof T as undefined extends z.output<T[K] & z.ZodType> ? K : never]?: z.output<T[K] & z.ZodType>;
      }
    >;

export interface RouteContext<Path extends string, Query, Body> {
  params: { [K in PathParams<Path>]: string };
  query: Query;
  body: Body;
  c: Context;
}

export interface RouteDef<
  Path extends string = string,
  Method extends HttpMethod = HttpMethod,
  Query = unknown,
  Body = unknown,
  Response = unknown,
> {
  path: Path;
  method: Method;
  query?: Shape;
  body?: Shape;
  handler(ctx: RouteContext<Path, Query, Body>): Promise<Response> | Response;
}

export function route<
  const Path extends string,
  const Method extends HttpMethod,
  const Q extends Shape = never,
  const B extends Shape = never,
  R = unknown,
>(
  path: Path,
  method: Method,
  config: {
    query?: Q;
    body?: B;
    handler: (ctx: RouteContext<Path, InferShape<Q>, InferShape<B>>) => Promise<R> | R;
  }
): RouteDef<Path, Method, InferShape<Q>, InferShape<B>, R> {
  return { path, method, query: config.query, body: config.body, handler: config.handler };
}

export type ApiOf<T extends readonly RouteDef[]> = {
  [Path in T[number]["path"]]: {
    [Method in Extract<T[number], { path: Path }>["method"]]: Extract<
      T[number],
      { path: Path; method: Method }
    > extends RouteDef<Path, Method, infer Query, infer Body, infer Response>
      ? {
          params: [PathParams<Path>] extends [never] ? never : { [K in PathParams<Path>]: string };
          query: Query;
          body: Body;
          response: Awaited<Response>;
        }
      : never;
  };
};

export function mount(app: Hono, routes: readonly RouteDef[]): void {
  for (const def of routes) {
    app.on(def.method, def.path, async c => {
      const query = def.query ? z.object(def.query).parse(c.req.query()) : undefined;
      const body = def.body ? z.object(def.body).parse(await c.req.json()) : undefined;
      const result = await def.handler({ params: c.req.param() as never, query, body, c });
      return c.json(result as object);
    });
  }
}

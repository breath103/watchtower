import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";

import type { Database } from "../db/index.js";

const COOKIE = "wt_session";
const TTL_S = 30 * 24 * 60 * 60;

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();
const same = (a: string, b: string): boolean => timingSafeEqual(digest(a), digest(b));

export function createAuth(db: Database, admin: { username: string; password: string }) {
  let stored = db.getSetting("session.secret");
  if (!stored) {
    stored = randomBytes(32).toString("hex");
    db.setSetting("session.secret", stored);
  }
  // Changing the admin credentials signs every session out.
  const secret = digest(`${stored}:${admin.username}:${admin.password}`).toString("hex");

  const signedIn = async (c: Context): Promise<boolean> => {
    const expires = await getSignedCookie(c, secret, COOKIE);
    return typeof expires === "string" && Number(expires) > Date.now();
  };

  return {
    signedIn,
    matches: (username: string, password: string): boolean =>
      [same(username, admin.username), same(password, admin.password)].every(Boolean),
    signIn: (c: Context): Promise<void> =>
      setSignedCookie(c, COOKIE, String(Date.now() + TTL_S * 1000), secret, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: TTL_S,
        secure: new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https",
      }),
    signOut: (c: Context): void => {
      deleteCookie(c, COOKIE, { path: "/" });
    },
    required: (async (c, next) => {
      if (!(await signedIn(c))) {
        return c.json({ error: { code: "unauthenticated", message: "sign in required" } }, 401);
      }
      await next();
    }) satisfies MiddlewareHandler,
  };
}

export type Auth = ReturnType<typeof createAuth>;

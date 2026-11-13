import { ScanEye } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { api } from "./api.js";

export function LoginPage({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border bg-card p-6"
        onSubmit={event => {
          event.preventDefault();
          setBusy(true);
          setError("");
          api("/api/login", "POST", { body: { username, password } })
            .then(onSignedIn)
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="flex items-center gap-2.5 pb-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ScanEye className="size-4" />
          </div>
          <span className="font-semibold tracking-tight">Watchtower</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-username">Username</Label>
          <Input
            id="login-username"
            autoComplete="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="login-password">Password</Label>
          <Input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={busy || !username || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}

import { LogOut, Plus, ScanEye } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, SIGNED_OUT } from "./api.js";
import { ConnectNvr } from "./connect.js";
import { LoginPage } from "./login.js";
import { LogsPage } from "./logs.js";
import type { Route } from "./router.js";
import { navigate, useRoute } from "./router.js";
import { SettingsPage } from "./settings.js";
import { WatchPage } from "./watch.js";

const NAV: Array<{ route: Route; label: string }> = [
  { route: "cameras", label: "Cameras" },
  { route: "logs", label: "Logs" },
  { route: "settings", label: "Settings" },
];

export function App() {
  const page = useRoute();
  const [connectOpen, setConnectOpen] = useState(false);
  const [nvrsVersion, setNvrsVersion] = useState(0);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void api("/api/session", "GET").then(session => setSignedIn(session.signedIn));
    const onSignedOut = (): void => setSignedIn(false);
    window.addEventListener(SIGNED_OUT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT, onSignedOut);
  }, []);

  if (signedIn === null) return null;
  if (!signedIn) return <LoginPage onSignedIn={() => setSignedIn(true)} />;

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-8 px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ScanEye className="size-4" />
            </div>
            <span className="font-semibold tracking-tight">Watchtower</span>
          </div>
          <nav className="flex items-center gap-1">
            {NAV.map(item => (
              <button
                key={item.route}
                type="button"
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  page === item.route ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => navigate(item.route)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setConnectOpen(true)}>
            <Plus />
            Add NVR
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Sign out"
            title="Sign out"
            onClick={() => void api("/api/logout", "POST").then(() => setSignedIn(false))}
          >
            <LogOut />
          </Button>
        </div>
      </header>
      {page === "cameras" ? <WatchPage key={nvrsVersion} /> : null}
      {page === "logs" ? <LogsPage /> : null}
      {page === "settings" ? <SettingsPage /> : null}
      <ConnectNvr
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onSaved={() => {
          setConnectOpen(false);
          setNvrsVersion(value => value + 1);
        }}
      />
    </>
  );
}

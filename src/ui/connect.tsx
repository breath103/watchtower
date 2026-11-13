// Connect-NVR wizard: pick a connector type, fill its (schema-rendered)
// connection config, test it, discover cameras, confirm, and persist.
// The form is generated from the connector's zod schema (as JSON Schema), so
// adding a vendor needs zero UI changes.

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { type ApiResponse, api } from "./api.js";
import { type FormValues, formPayload, formValues, type ObjectSchema, SchemaFields } from "./schema-form.js";

export type ConnectorInfo = ApiResponse<"/api/connectors", "GET">["connectors"][number];
type Discovered = ApiResponse<"/api/nvrs/discover", "POST">["cameras"][number];
interface WizardChannel extends Discovered {
  selected: boolean;
  label: string;
}

export function ConnectNvr({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (nvrId: string) => void;
}) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([]);
  const [connectorId, setConnectorId] = useState("");
  const [name, setName] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error" | ""; text: string }>({ kind: "", text: "" });
  const [channels, setChannels] = useState<WizardChannel[]>([]);

  useEffect(() => {
    if (!open) return;
    setMessage({ kind: "", text: "" });
    setChannels([]);
    void api("/api/connectors", "GET")
      .then(result => {
        setConnectors(result.connectors);
        const first = result.connectors.at(0);
        if (first) {
          setConnectorId(first.id);
          setValues(formValues(first.configSchema));
        }
      })
      .catch(error => setMessage({ kind: "error", text: String(error) }));
  }, [open]);

  const connector = connectors.find(entry => entry.id === connectorId);

  const connectionPayload = (): Record<string, unknown> =>
    connector ? formPayload(connector.configSchema, values) : {};

  const run = async (label: string, task: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setMessage({ kind: "", text: "" });
    try {
      await task();
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    } finally {
      setBusy("");
    }
  };

  const selectConnector = (id: string): void => {
    setConnectorId(id);
    setChannels([]);
    const next = connectors.find(entry => entry.id === id);
    if (next) setValues(formValues(next.configSchema));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect NVR</DialogTitle>
          <DialogDescription>Pick a device type, test the connection, discover cameras, then save.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Label htmlFor="connect-connector">Device type</Label>
          <Select value={connectorId} onValueChange={selectConnector}>
            <SelectTrigger id="connect-connector">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {connectors.map(entry => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {connector?.description ? <p className="text-sm text-muted-foreground">{connector.description}</p> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="connect-name">Name</Label>
            <Input id="connect-name" value={name} placeholder="office-nvr" onChange={e => setName(e.target.value)} />
          </div>

          {connector ? (
            <SchemaFields schema={connector.configSchema} values={values} onChange={setValues} idPrefix="connect" />
          ) : null}

          <div className="flex gap-2">
            <Button
              disabled={busy !== ""}
              onClick={() =>
                void run("test", async () => {
                  const result = await api("/api/nvrs/test", "POST", {
                    body: { connector: connectorId, connection: connectionPayload() },
                  });
                  setMessage(
                    result.ok
                      ? { kind: "ok", text: `connected${result.model ? ` — ${result.model}` : ""}` }
                      : { kind: "error", text: result.error ?? "connection failed" }
                  );
                })
              }
            >
              {busy === "test" ? "Testing…" : "Test connection"}
            </Button>
            <Button
              variant="outline"
              disabled={busy !== ""}
              onClick={() =>
                void run("discover", async () => {
                  const result = await api("/api/nvrs/discover", "POST", {
                    body: { connector: connectorId, connection: connectionPayload() },
                  });
                  setChannels(result.cameras.map(ch => ({ ...ch, selected: true, label: ch.name })));
                  setMessage({ kind: "ok", text: `${result.cameras.length} camera(s) found` });
                })
              }
            >
              {busy === "discover" ? "Discovering…" : "Discover cameras"}
            </Button>
          </div>

          {channels.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border p-2">
              {channels.map((channel, index) => (
                <div key={channel.key} className="grid grid-cols-[90px_1fr] items-center gap-2">
                  <span className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={channel.selected}
                      onCheckedChange={checked =>
                        setChannels(prev =>
                          prev.map((entry, i) => (i === index ? { ...entry, selected: checked === true } : entry))
                        )
                      }
                    />
                    {channel.key}
                  </span>
                  <Input
                    value={channel.label}
                    onChange={e =>
                      setChannels(prev =>
                        prev.map((entry, i) => (i === index ? { ...entry, label: e.target.value } : entry))
                      )
                    }
                  />
                </div>
              ))}
            </div>
          ) : null}

          {message.text ? (
            <div className={cn("text-sm", message.kind === "ok" ? "text-success" : "text-destructive")}>
              {message.text}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            disabled={busy !== "" || channels.filter(ch => ch.selected).length === 0 || name.trim() === ""}
            onClick={() =>
              void run("save", async () => {
                const result = await api("/api/nvrs", "POST", {
                  body: {
                    name: name.trim(),
                    connector: connectorId,
                    connection: connectionPayload(),
                    cameras: channels
                      .filter(ch => ch.selected)
                      .map(ch => ({ key: ch.key, name: ch.label, metadata: ch.metadata })),
                  },
                });
                onSaved(result.id);
              })
            }
          >
            {busy === "save" ? "Saving…" : "Save NVR"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

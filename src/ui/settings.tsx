import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { type ApiResponse, api } from "./api.js";
import { ApiKeysCard } from "./api-keys.js";
import { ConfirmDialog } from "./confirm.js";
import { type FormValues, formPayload, formValues, SchemaFields } from "./schema-form.js";

type StorageCatalog = ApiResponse<"/api/storages", "GET">;
type StorageType = StorageCatalog["types"][number];
type StorageRow = StorageCatalog["storages"][number];
type ThumbnailConfigs = ApiResponse<"/api/thumbnails/config", "GET">;
type CameraThumbCfg = ThumbnailConfigs["cameras"][number];
type Message = { kind: "ok" | "error" | ""; text: string };

export function SettingsPage() {
  const [thumbnailsOn, setThumbnailsOn] = useState(false);
  const [cameras, setCameras] = useState<CameraThumbCfg[]>([]);
  const [storages, setStorages] = useState<StorageRow[]>([]);
  const [defaultStorage, setDefaultStorage] = useState<string | null>(null);
  const [types, setTypes] = useState<StorageType[]>([]);
  const [message, setMessage] = useState<Message>({ kind: "", text: "" });

  const fail = (error: unknown): void => setMessage({ kind: "error", text: String(error) });

  const reload = useCallback(async (): Promise<void> => {
    const [catalog, thumbs] = await Promise.all([api("/api/storages", "GET"), api("/api/thumbnails/config", "GET")]);
    setThumbnailsOn(catalog.thumbnails);
    setTypes(catalog.types);
    setStorages(catalog.storages);
    setDefaultStorage(catalog.defaultStorage);
    setCameras(thumbs.cameras);
  }, []);

  useEffect(() => {
    void reload().catch(fail);
  }, [reload]);

  const selected = cameras.filter(row => row.enabled).length;

  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-6 px-6 py-8">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-6">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Thumbnail capture</CardTitle>
            <CardDescription>
              {thumbnailsOn
                ? `On — capturing ${selected} of ${cameras.length} cameras.`
                : selected > 0
                  ? `Off — nothing is captured. The ${selected} selected camera${selected === 1 ? "" : "s"} will start when you turn this on.`
                  : "Off — nothing is captured."}
            </CardDescription>
          </div>
          <Switch
            aria-label="Thumbnail capture"
            checked={thumbnailsOn}
            onCheckedChange={enabled => {
              setThumbnailsOn(enabled);
              void api("/api/settings/thumbnails", "POST", { body: { enabled } })
                .then(() => setMessage({ kind: "ok", text: `Capture ${enabled ? "on" : "off"}` }))
                .catch(fail);
            }}
          />
        </CardHeader>
      </Card>

      <StoragesCard
        storages={storages}
        defaultStorage={defaultStorage}
        types={types}
        onChanged={() => reload()}
        onMessage={setMessage}
      />

      <ApiKeysCard onError={fail} />

      {message.text ? (
        <div className={cn("text-sm", message.kind === "ok" ? "text-success" : "text-destructive")}>{message.text}</div>
      ) : null}
    </main>
  );
}

interface StoragesProps {
  storages: StorageRow[];
  defaultStorage: string | null;
  types: StorageType[];
  onChanged: () => Promise<void>;
  onMessage: (message: Message) => void;
}

const summary = (config: Record<string, unknown>): string =>
  Object.entries(config)
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" · ");

function StoragesCard({ storages, defaultStorage, types, onChanged, onMessage }: StoragesProps) {
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; storage: StorageRow } | null>(null);
  const [deleting, setDeleting] = useState<StorageRow | null>(null);
  const fail = (error: unknown): void => onMessage({ kind: "error", text: String(error) });
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <CardTitle>Storage</CardTitle>
          <CardDescription>
            Where thumbnails are uploaded. Cameras set to "Default" use the default one.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "add" })}>
          <Plus />
          Add storage
        </Button>
      </CardHeader>
      <CardContent>
        {storages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No storage configured yet.</p>
        ) : (
          <Table className="table-fixed">
            <TableBody>
              {storages.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="w-40 font-medium">{row.id}</TableCell>
                  <TableCell className="w-16 text-muted-foreground">{row.type}</TableCell>
                  <TableCell className="truncate text-muted-foreground" title={summary(row.config)}>
                    {summary(row.config)}
                  </TableCell>
                  <TableCell className="w-56">
                    <div className="flex items-center justify-end gap-1">
                      {row.id === defaultStorage ? (
                        <Badge>Default</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void api("/api/storages/default", "POST", { body: { id: row.id } })
                              .then(onChanged)
                              .catch(fail)
                          }
                        >
                          Make default
                        </Button>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${row.id}`}
                        onClick={() => setDialog({ mode: "edit", storage: row })}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${row.id}`}
                        disabled={row.id === defaultStorage}
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <StorageDialog
        state={dialog}
        types={types}
        onClose={() => setDialog(null)}
        onSaved={text => {
          setDialog(null);
          onMessage({ kind: "ok", text });
          void onChanged().catch(fail);
        }}
        onError={fail}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete storage ${deleting?.id ?? ""}?`}
        description="Cameras using it switch to the default storage. Images already stored there are not deleted, but Watchtower forgets them."
        action="Delete storage"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await api("/api/storages/:id", "DELETE", { params: { id: deleting.id } });
            setDeleting(null);
            onMessage({ kind: "ok", text: "Storage deleted" });
            await onChanged();
          } catch (error) {
            fail(error);
          }
        }}
      />
    </Card>
  );
}

interface StorageDialogProps {
  state: { mode: "add" } | { mode: "edit"; storage: StorageRow } | null;
  types: StorageType[];
  onClose: () => void;
  onSaved: (message: string) => void;
  onError: (error: unknown) => void;
}

function StorageDialog({ state, types, onClose, onSaved, onError }: StorageDialogProps) {
  const [typeId, setTypeId] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const editing = state?.mode === "edit" ? state.storage : null;
  const type = types.find(entry => entry.id === typeId);

  useEffect(() => {
    if (!state) return;
    const initial = editing ? types.find(entry => entry.id === editing.type) : types.at(0);
    if (!initial) return;
    setTypeId(initial.id);
    setValues(formValues(initial.configSchema, editing?.config));
  }, [state, types]);

  const save = (): void => {
    if (!type) return;
    const config = formPayload(type.configSchema, values);
    const request = editing
      ? api("/api/storages/:id", "PUT", { params: { id: editing.id }, body: { config } })
      : api("/api/storages", "POST", { body: { type: typeId, config } });
    void request.then(() => onSaved(editing ? "Storage saved" : "Storage added")).catch(onError);
  };

  return (
    <Dialog open={state !== null} onOpenChange={next => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? `Edit storage ${editing.id}` : "Add storage"}</DialogTitle>
          {type?.description ? <DialogDescription>{type.description}</DialogDescription> : null}
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {editing ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="storage-type">Type</Label>
              <Select
                value={typeId}
                onValueChange={value => {
                  setTypeId(value);
                  const next = types.find(entry => entry.id === value);
                  if (next) setValues(formValues(next.configSchema));
                }}
              >
                <SelectTrigger id="storage-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map(entry => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type ? (
            <SchemaFields
              schema={type.configSchema}
              values={values}
              onChange={setValues}
              idPrefix="storage"
              keepSecrets={editing !== null}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>{editing ? "Save" : "Add storage"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

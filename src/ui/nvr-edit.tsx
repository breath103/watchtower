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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

import { type ApiResponse, api } from "./api.js";
import { ConfirmDialog } from "./confirm.js";
import type { ConnectorInfo } from "./connect.js";
import { type FormValues, formPayload, formValues, SchemaFields } from "./schema-form.js";
import { ago } from "./time.js";

type NvrDetail = ApiResponse<"/api/nvrs/:id", "GET">;
type StorageRow = ApiResponse<"/api/storages", "GET">["storages"][number];
type ThumbnailConfig = ApiResponse<"/api/thumbnails/config", "GET">["cameras"][number];
type CameraRow = NvrDetail["cameras"][number] & {
  capture: Pick<ThumbnailConfig, "enabled" | "storageId" | "frequencyS">;
  state: ThumbnailConfig["state"];
};

const FREQUENCIES = [10, 15, 30, 60, 300, 900, 3600];
const freqLabel = (s: number): string =>
  s < 60 ? `every ${s}s` : s < 3600 ? `every ${s / 60} min` : `every ${s / 3600} h`;

// Radix Select forbids empty-string item values, so the "default storage"
// option uses a sentinel that maps back to storageId === null.
const DEFAULT_STORAGE = "__default__";
const NO_CAPTURE = { enabled: false, storageId: null, frequencyS: 30 };

export function EditNvrDialog({
  nvrId,
  onClose,
  onChanged,
  onError,
}: {
  nvrId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) {
  const [nvr, setNvr] = useState<NvrDetail | null>(null);
  const [connector, setConnector] = useState<ConnectorInfo | null>(null);
  const [name, setName] = useState("");
  const [values, setValues] = useState<FormValues>({});
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [original, setOriginal] = useState<CameraRow[]>([]);
  const [storages, setStorages] = useState<StorageRow[]>([]);
  const [defaultStorage, setDefaultStorage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setNvr(null);
    if (!nvrId) return;
    void Promise.all([
      api("/api/nvrs/:id", "GET", { params: { id: nvrId } }),
      api("/api/connectors", "GET"),
      api("/api/storages", "GET"),
      api("/api/thumbnails/config", "GET"),
    ])
      .then(([detail, catalog, storageCatalog, thumbnails]) => {
        const def = catalog.connectors.find(entry => entry.id === detail.connector) ?? null;
        const configs = new Map(thumbnails.cameras.map(cfg => [cfg.cameraId, cfg]));
        const rows = detail.cameras.map(camera => {
          const cfg = configs.get(camera.id);
          return {
            ...camera,
            capture: cfg ? { enabled: cfg.enabled, storageId: cfg.storageId, frequencyS: cfg.frequencyS } : NO_CAPTURE,
            state: cfg?.state ?? null,
          };
        });
        setNvr(detail);
        setConnector(def);
        setName(detail.name);
        setValues(def ? formValues(def.configSchema, detail.connection) : {});
        setCameras(rows);
        setOriginal(rows);
        setStorages(storageCatalog.storages);
        setDefaultStorage(storageCatalog.defaultStorage);
      })
      .catch(onError);
  }, [nvrId]);

  const save = async (): Promise<void> => {
    if (!nvr || !connector) return;
    setSaving(true);
    try {
      await api("/api/nvrs/:id", "PUT", {
        params: { id: nvr.id },
        body: {
          name: name.trim(),
          connection: formPayload(connector.configSchema, values),
          cameras: cameras.map(({ id, name: cameraName }) => ({ id, name: cameraName })),
        },
      });
      const changed = cameras.filter(
        (camera, index) => JSON.stringify(camera.capture) !== JSON.stringify(original[index]?.capture)
      );
      await Promise.all(
        changed.map(camera =>
          api("/api/thumbnails/config", "POST", { body: { cameraId: camera.id, ...camera.capture } })
        )
      );
      onChanged();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog open={nvrId !== null && nvr !== null} onOpenChange={next => !next && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit NVR</DialogTitle>
            <DialogDescription>
              {nvr?.id} · {connector?.title ?? nvr?.connector}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-nvr-name">Name</Label>
              <Input id="edit-nvr-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            {connector ? (
              <SchemaFields
                schema={connector.configSchema}
                values={values}
                onChange={setValues}
                idPrefix="edit-nvr"
                keepSecrets
              />
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label>Cameras</Label>
              <CameraTable
                cameras={cameras}
                storages={storages}
                defaultStorage={defaultStorage}
                onChange={(id, patch) =>
                  setCameras(prev => prev.map(camera => (camera.id === id ? { ...camera, ...patch } : camera)))
                }
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)}>
              Delete NVR
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button disabled={saving || !name.trim()} onClick={() => void save()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${nvr?.name ?? "NVR"}?`}
        description="Its cameras and their thumbnail index are removed from Watchtower. Stored images are not deleted."
        action="Delete NVR"
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (!nvr) return;
          try {
            await api("/api/nvrs/:id", "DELETE", { params: { id: nvr.id } });
            setConfirmDelete(false);
            onChanged();
          } catch (error) {
            onError(error);
          }
        }}
      />
    </>
  );
}

function CameraTable({
  cameras,
  storages,
  defaultStorage,
  onChange,
}: {
  cameras: CameraRow[];
  storages: StorageRow[];
  defaultStorage: string | null;
  onChange: (id: string, patch: Partial<CameraRow>) => void;
}) {
  const on = cameras.filter(camera => camera.capture.enabled).length;
  const setCapture = (camera: CameraRow, patch: Partial<CameraRow["capture"]>): void =>
    onChange(camera.id, { capture: { ...camera.capture, ...patch } });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label="Capture thumbnails for every camera"
              checked={on === 0 ? false : on === cameras.length ? true : "indeterminate"}
              onCheckedChange={() => {
                for (const camera of cameras) setCapture(camera, { enabled: on !== cameras.length });
              }}
            />
          </TableHead>
          <TableHead>Name</TableHead>
          <TableHead className="w-48">Storage</TableHead>
          <TableHead className="w-36">Interval</TableHead>
          <TableHead className="w-28">Last capture</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {cameras.map(camera => (
          <TableRow key={camera.id}>
            <TableCell>
              <Checkbox
                aria-label={`Capture thumbnails for ${camera.name}`}
                checked={camera.capture.enabled}
                onCheckedChange={enabled => setCapture(camera, { enabled: enabled === true })}
              />
            </TableCell>
            <TableCell>
              <Input
                aria-label={`Name of ${camera.id}`}
                className="h-8"
                value={camera.name}
                onChange={e => onChange(camera.id, { name: e.target.value })}
              />
            </TableCell>
            {camera.capture.enabled ? (
              <>
                <TableCell>
                  <Select
                    value={camera.capture.storageId ?? DEFAULT_STORAGE}
                    onValueChange={value => setCapture(camera, { storageId: value === DEFAULT_STORAGE ? null : value })}
                  >
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_STORAGE}>
                        {defaultStorage && defaultStorage !== "default" ? `Default (${defaultStorage})` : "Default"}
                      </SelectItem>
                      {storages.map(storage => (
                        <SelectItem key={storage.id} value={storage.id}>
                          {storage.id} · {storage.type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={String(camera.capture.frequencyS)}
                    onValueChange={value => setCapture(camera, { frequencyS: Number(value) })}
                  >
                    <SelectTrigger className="h-8 w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {!FREQUENCIES.includes(camera.capture.frequencyS) ? (
                        <SelectItem value={String(camera.capture.frequencyS)}>
                          {freqLabel(camera.capture.frequencyS)}
                        </SelectItem>
                      ) : null}
                      {FREQUENCIES.map(freq => (
                        <SelectItem key={freq} value={String(freq)}>
                          {freqLabel(freq)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </>
            ) : (
              <>
                <TableCell className="text-muted-foreground">—</TableCell>
                <TableCell className="text-muted-foreground">—</TableCell>
              </>
            )}
            <TableCell
              className={cn("text-sm text-muted-foreground", camera.state && !camera.state.ok && "text-destructive")}
            >
              {camera.state
                ? camera.state.ok
                  ? ago(camera.state.lastTs, true)
                  : `Error: ${camera.state.error}`
                : "Never"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

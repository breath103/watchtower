import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { type ApiResponse, api } from "./api.js";

type ApiKey = ApiResponse<"/api/keys", "GET">["keys"][number];

const formatDate = (ms: number | null): string =>
  ms === null ? "Never" : new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function ApiKeysCard({ onError }: { onError: (error: unknown) => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setKeys((await api("/api/keys", "GET")).keys);
  }, []);

  useEffect(() => {
    void reload().catch(onError);
  }, [reload]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Let other systems read cameras from <code>/api/v1</code> with <code>Authorization: Bearer &lt;key&gt;</code>
            .
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
          <Plus />
          Create key
        </Button>
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No API keys yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map(key => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">wt_…{key.hint}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(key.createdAt)}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(key.lastUsedAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Revoke ${key.name}`}
                      onClick={() =>
                        void api("/api/keys/:id", "DELETE", { params: { id: key.id } })
                          .then(reload)
                          .catch(onError)
                      }
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <CreateKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={key => {
          setCreating(false);
          setCreated(key);
          void reload().catch(onError);
        }}
        onError={onError}
      />
      <CreatedKeyDialog value={created} onClose={() => setCreated(null)} />
    </Card>
  );
}

function CreateKeyDialog({
  open,
  onClose,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: string) => void;
  onError: (error: unknown) => void;
}) {
  const [name, setName] = useState("");
  const submit = (): void => {
    void api("/api/keys", "POST", { body: { name } })
      .then(result => {
        setName("");
        onCreated(result.key);
      })
      .catch(onError);
  };
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API key</DialogTitle>
          <DialogDescription>Name it after the system that will use it.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={event => {
            event.preventDefault();
            if (name.trim()) submit();
          }}
        >
          <Label htmlFor="api-key-name">Name</Label>
          <Input id="api-key-name" value={name} placeholder="My app" onChange={e => setName(e.target.value)} autoFocus />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={submit}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatedKeyDialog({ value, onClose }: { value: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog
      open={value !== null}
      onOpenChange={next => {
        if (next) return;
        setCopied(false);
        onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy your API key</DialogTitle>
          <DialogDescription>This is the only time it is shown. Only a hash is stored.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input readOnly value={value ?? ""} className="font-mono" onFocus={e => e.currentTarget.select()} />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy key"
            onClick={() => {
              if (!value) return;
              void navigator.clipboard.writeText(value).then(() => setCopied(true));
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

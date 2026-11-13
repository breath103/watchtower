import type { StorageDef } from "../storage/types.js";
import type { ConnectorDef } from "./connector.js";

// Registries are plain maps filled at bootstrap; adding a vendor or a storage
// backend is one register() call, nothing else changes.
export class Registry {
  readonly connectors = new Map<string, ConnectorDef<unknown>>();
  readonly storages = new Map<string, StorageDef<unknown>>();

  registerConnector<Config>(def: ConnectorDef<Config>): void {
    this.connectors.set(def.id, def as ConnectorDef<unknown>);
  }

  registerStorage<Config>(def: StorageDef<Config>): void {
    this.storages.set(def.id, def as StorageDef<unknown>);
  }

  connector(id: string): ConnectorDef<unknown> {
    const def = this.connectors.get(id);
    if (!def) throw new Error(`unknown connector type: ${id}`);
    return def;
  }

  storage(id: string): StorageDef<unknown> {
    const def = this.storages.get(id);
    if (!def) throw new Error(`unknown storage type: ${id}`);
    return def;
  }
}

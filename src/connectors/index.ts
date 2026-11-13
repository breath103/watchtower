// Every connector + storage backend registers here at bootstrap. Adding a
// vendor = one folder under vendors/ + one registerConnector call.

import { Registry } from "../core/registry.js";
import { FileStorage } from "../storage/file.js";
import { S3Storage } from "../storage/s3.js";
import { AdtcapsConnector } from "./vendors/adtcaps/index.js";

export function createRegistry(): Registry {
  const registry = new Registry();
  registry.registerConnector(AdtcapsConnector);
  registry.registerStorage(FileStorage);
  registry.registerStorage(S3Storage);
  return registry;
}

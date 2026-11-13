import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { configSchema } from "../src/config.js";

const out = path.join(import.meta.dirname, "..", "config.schema.json");
const schema = z.toJSONSchema(configSchema, { io: "input" });
fs.writeFileSync(out, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`wrote ${out}`);

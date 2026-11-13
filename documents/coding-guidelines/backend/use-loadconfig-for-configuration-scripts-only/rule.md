# Read configuration only through `loadConfig()` — once, at startup

Process configuration (`config.json`) is read by `loadConfig(argv)` in `src/config.ts`, validated by `configSchema`,
and called exactly once, in `main()` in `src/index.ts`. Everything else receives the values it needs as constructor /
function arguments (`new ThumbnailService({ ..., workDir })`, `createAuth(db, config.admin)`).

```ts
// ✅ Correct — src/index.ts reads config once and passes values down
const { config, source } = loadConfig(process.argv.slice(2));
const db = new Database(path.join(config.workDir, "watchtower.db"));
```

```ts
// ❌ Wrong — a service re-reads the file (or process.env) on its own
const port = JSON.parse(fs.readFileSync("config.json", "utf8")).port;
```

Adding a setting:
1. Add it to `configSchema` with a `.default(...)` (if optional) and a `.describe(...)`.
2. Run `npm run config:schema` to regenerate `config.schema.json`, and update `config.example.json`.
3. Thread the value from `main()` to the consumer.

Runtime-editable settings (default storage, thumbnails on/off) are not process config — they live in the `settings`
table via `db.getSetting` / `db.setSetting`.

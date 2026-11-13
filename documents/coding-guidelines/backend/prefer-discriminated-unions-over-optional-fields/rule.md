# Prefer discriminated unions over optional fields

When fields are mutually exclusive, model them as a discriminated union instead of a bag of optionals. The union
rules out impossible states and lets `switch` check exhaustiveness.

```ts
// ✅ Correct — each variant carries exactly its own fields (src/ui/viewport.ts)
export type Source =
  | { kind: "live"; camera: string; stream: string }
  | { kind: "recording"; camera: string; stream: string; start: number; end: number };
```

```ts
// ❌ Wrong — `error` can be set when ok is true, `model` when ok is false
type TestResult = { ok: boolean; model?: string; error?: string };
// ✅ Instead
type TestResult = { ok: true; model: string | null } | { ok: false; error: string };
```

New contracts use the union form.

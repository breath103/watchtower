// Forms rendered from a zod schema exported as JSON Schema, so a new connector
// or storage type needs no UI changes.

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { JsonObjectSchema as ObjectSchema } from "../api/helpers.js";

export type { ObjectSchema };

export type FormValues = Record<string, string>;

export const isSecret = (key: string): boolean => /pass|secret|token/i.test(key);

const asText = (value: unknown): string =>
  value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);

export function formValues(schema: ObjectSchema, current: Record<string, unknown> = {}): FormValues {
  const out: FormValues = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    out[key] = key in current ? asText(current[key]) : asText(prop.default);
  }
  return out;
}

// Empty fields are left out so optional settings can be cleared and the
// server applies defaults.
export function formPayload(schema: ObjectSchema, values: FormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const raw = (values[key] ?? "").trim();
    if (raw === "") continue;
    if (prop.type === "number" || prop.type === "integer") out[key] = Number(raw);
    else if (prop.type === "boolean") out[key] = raw === "true";
    else out[key] = raw;
  }
  return out;
}

export function SchemaFields({
  schema,
  values,
  onChange,
  idPrefix,
  keepSecrets = false,
}: {
  schema: ObjectSchema;
  values: FormValues;
  onChange: (values: FormValues) => void;
  idPrefix: string;
  keepSecrets?: boolean;
}) {
  return (
    <>
      {Object.entries(schema.properties ?? {}).map(([key, prop]) => {
        const secret = isSecret(key);
        return (
          <div key={key} className="flex flex-col gap-1.5">
            <Label htmlFor={`${idPrefix}-${key}`}>{key}</Label>
            <Input
              id={`${idPrefix}-${key}`}
              type={prop.type === "number" || prop.type === "integer" ? "number" : secret ? "password" : "text"}
              value={values[key] ?? ""}
              placeholder={secret && keepSecrets ? "Unchanged" : undefined}
              onChange={e => onChange({ ...values, [key]: e.target.value })}
            />
            {prop.description && !(secret && keepSecrets) ? (
              <p className="text-sm text-muted-foreground">{prop.description}</p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

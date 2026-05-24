import { z, type ZodTypeAny } from "zod";

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  oneOf?: JsonSchema[];
  additionalProperties?: boolean;
};

/** Minimal Zod → JSON schema converter. Covers the shapes we use in this server. */
export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  const tn = def.typeName;
  if (tn === "ZodObject") {
    const shape = (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      const inner = unwrap(v);
      properties[k] = zodToJsonSchema(inner.type);
      const desc = (v as unknown as { _def: { description?: string } })._def.description;
      if (desc) properties[k].description = desc;
      if (!inner.optional) required.push(k);
    }
    return { type: "object", properties, required: required.length ? required : undefined, additionalProperties: false };
  }
  if (tn === "ZodString") return { type: "string" };
  if (tn === "ZodNumber") return { type: "number" };
  if (tn === "ZodBoolean") return { type: "boolean" };
  if (tn === "ZodArray") {
    return { type: "array", items: zodToJsonSchema((def as unknown as { type: ZodTypeAny }).type) };
  }
  if (tn === "ZodEnum") {
    return { type: "string", enum: (def as unknown as { values: string[] }).values };
  }
  if (tn === "ZodLiteral") {
    const v = (def as unknown as { value: unknown }).value;
    return { type: typeof v as string, enum: [v] };
  }
  if (tn === "ZodUnion") {
    const options = (def as unknown as { options: ZodTypeAny[] }).options.map(zodToJsonSchema);
    return { oneOf: options };
  }
  if (tn === "ZodRecord") {
    return { type: "object", additionalProperties: true };
  }
  if (tn === "ZodAny" || tn === "ZodUnknown") return {};
  if (tn === "ZodNullable" || tn === "ZodOptional") {
    return zodToJsonSchema((def as unknown as { innerType: ZodTypeAny }).innerType);
  }
  return {};
}

function unwrap(schema: ZodTypeAny): { type: ZodTypeAny; optional: boolean } {
  let optional = false;
  let current = schema;
  while (true) {
    const tn = (current as unknown as { _def: { typeName: string } })._def.typeName;
    if (tn === "ZodOptional" || tn === "ZodDefault" || tn === "ZodNullable") {
      optional = true;
      current = (current as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType;
    } else break;
  }
  return { type: current, optional };
}

export const refOrSelector = z.string().describe("Element ref like e3 from a prior browser_snapshot, OR a raw Playwright selector (css=, xpath=, text=, role=).");

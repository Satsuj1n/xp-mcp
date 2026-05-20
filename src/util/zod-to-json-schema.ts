import type { ZodObject, ZodRawShape, ZodTypeAny } from "zod";

/**
 * Minimal zod -> JSON Schema converter, just enough for MCP tool input schemas.
 *
 * Why hand-rolled instead of pulling `zod-to-json-schema`:
 *  - One less dependency.
 *  - We only support the small subset of zod we use (string, enum, optional).
 *  - Easier to debug what MCP clients actually receive.
 *
 * If we ever need ZodNumber, ZodBoolean, ZodArray, etc., add a branch here.
 */
export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, JsonSchemaProp>;
  required: string[];
  additionalProperties: boolean;
}

interface JsonSchemaProp {
  type?: string;
  description?: string;
  enum?: readonly string[];
}

export function zodToJsonSchema(
  schema: ZodObject<ZodRawShape>,
): JsonSchemaObject {
  const shape = schema.shape;
  const properties: Record<string, JsonSchemaProp> = {};
  const required: string[] = [];

  for (const key of Object.keys(shape)) {
    const field = shape[key] as ZodTypeAny;
    const { prop, isRequired } = convertField(field);
    properties[key] = prop;
    if (isRequired) required.push(key);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function convertField(field: ZodTypeAny): {
  prop: JsonSchemaProp;
  isRequired: boolean;
} {
  // Unwrap ZodOptional and ZodDefault — both make a field non-required at the JSON-Schema level.
  const typeName = (field._def as { typeName?: string }).typeName;
  if (typeName === "ZodOptional" || typeName === "ZodDefault") {
    const inner = (field._def as { innerType: ZodTypeAny }).innerType;
    const { prop } = convertField(inner);
    return { prop, isRequired: false };
  }

  const description = (field._def as { description?: string }).description;

  if (typeName === "ZodString") {
    return { prop: { type: "string", description }, isRequired: true };
  }
  if (typeName === "ZodNumber") {
    return { prop: { type: "number", description }, isRequired: true };
  }
  if (typeName === "ZodBoolean") {
    return { prop: { type: "boolean", description }, isRequired: true };
  }
  if (typeName === "ZodEnum") {
    const values = (field._def as { values: readonly string[] }).values;
    return {
      prop: { type: "string", enum: values, description },
      isRequired: true,
    };
  }

  // Fallback — accept anything. Better than crashing the server schema export.
  return { prop: { description }, isRequired: true };
}

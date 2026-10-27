/**
 * A small JSON Schema (draft 2020-12) validator for the subset our config schemas use: type, enum,
 * const, properties, required, additionalProperties, patternProperties, items, minItems, maxItems,
 * minimum, maximum, minLength, maxLength, pattern, format "uri", and $ref to "#/$defs/...".
 *
 * Why not Ajv: it compiles schemas with `new Function`, which Manifest V3's CSP forbids.
 */
export interface JsonSchema {
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  patternProperties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  description?: string;
  [key: string]: unknown;
}

export interface SchemaError {
  /** JSON Pointer-ish path, e.g. "/screens/NOC-Wall-1/playlist/0/url". */
  path: string;
  message: string;
}

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
};

const matchesType = (value: unknown, type: string) => {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};

export function validate(schema: JsonSchema, value: unknown, maxErrors = 20): SchemaError[] {
  const errors: SchemaError[] = [];
  const root = schema;

  const resolve = (s: JsonSchema): JsonSchema => {
    if (!s.$ref) return s;
    const name = /^#\/\$defs\/(.+)$/.exec(s.$ref)?.[1];
    const target = name ? root.$defs?.[name] : undefined;
    if (!target) throw new Error(`Unresolvable $ref ${s.$ref}`);
    return resolve(target);
  };

  const check = (raw: JsonSchema, v: unknown, path: string) => {
    if (errors.length >= maxErrors) return;
    const s = resolve(raw);
    const fail = (message: string) => errors.push({ path: path || '/', message });

    if (s.type !== undefined) {
      const types = Array.isArray(s.type) ? s.type : [s.type];
      if (!types.some((t) => matchesType(v, t))) return fail(`must be ${types.join(' or ')}, got ${typeOf(v)}`);
    }
    if (s.const !== undefined && v !== s.const) fail(`must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.some((e) => e === v)) fail(`must be one of ${s.enum.map((e) => JSON.stringify(e)).join(', ')}`);

    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) fail(`must be at least ${s.minLength} characters`);
      if (s.maxLength !== undefined && v.length > s.maxLength) fail(`must be at most ${s.maxLength} characters`);
      if (s.pattern && !new RegExp(s.pattern, 'u').test(v)) fail(`must match ${s.pattern}`);
      if (s.format === 'uri' && !/^[a-z][a-z0-9+.-]*:\/\/[^\s]+$/i.test(v)) fail('must be a full URL (https://…)');
    }
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) fail(`must be ≥ ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) fail(`must be ≤ ${s.maximum}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) fail(`must have at least ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) fail(`must have at most ${s.maxItems} items`);
      if (s.items) v.forEach((item, i) => check(s.items!, item, `${path}/${i}`));
    }
    if (typeOf(v) === 'object') {
      const obj = v as Record<string, unknown>;
      for (const key of s.required ?? []) if (!(key in obj)) fail(`missing required property "${key}"`);
      for (const [key, child] of Object.entries(obj)) {
        const childPath = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (s.properties?.[key]) {
          check(s.properties[key]!, child, childPath);
          continue;
        }
        const patternSchema = Object.entries(s.patternProperties ?? {}).find(([p]) => new RegExp(p, 'u').test(key))?.[1];
        if (patternSchema) check(patternSchema, child, childPath);
        else if (s.additionalProperties === false) fail(`unknown property "${key}"`);
        else if (typeof s.additionalProperties === 'object') check(s.additionalProperties, child, childPath);
      }
    }
  };

  check(schema, value, '');
  return errors;
}

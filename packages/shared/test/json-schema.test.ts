import { describe, expect, it } from 'vitest';
import { validate, type JsonSchema } from '../src/json-schema.ts';

const schema: JsonSchema = {
  type: 'object',
  required: ['version'],
  additionalProperties: false,
  properties: {
    version: { const: 1 },
    name: { type: 'string', minLength: 1, maxLength: 5, pattern: '^[a-z]+$' },
    url: { type: 'string', format: 'uri' },
    n: { type: ['integer', 'null'], minimum: 2, maximum: 10 },
    kind: { enum: ['a', 'b'] },
    list: { type: 'array', maxItems: 2, items: { $ref: '#/$defs/item' } },
    byName: { type: 'object', patternProperties: { '^[A-Z]': { type: 'boolean' } }, additionalProperties: false },
  },
  $defs: { item: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
};

const errs = (value: unknown) => validate(schema, value).map((e) => `${e.path} ${e.message}`);

describe('validate', () => {
  it('accepts a valid document', () => {
    expect(errs({ version: 1, name: 'abc', url: 'https://x.example/a', n: null, kind: 'a', list: [{ id: 1 }], byName: { Lobby: true } })).toEqual([]);
  });

  it('reports each kind of violation with a path', () => {
    expect(errs({})).toEqual(['/ missing required property "version"']);
    expect(errs({ version: 2 })).toEqual(['/version must be 1']);
    expect(errs({ version: 1, extra: 1 })).toEqual(['/ unknown property "extra"']);
    expect(errs({ version: 1, name: '' })).toContain('/name must be at least 1 characters');
    expect(errs({ version: 1, name: 'ABC' })).toEqual(['/name must match ^[a-z]+$']);
    expect(errs({ version: 1, url: 'not a url' })).toEqual(['/url must be a full URL (https://…)']);
    expect(errs({ version: 1, n: 1.5 })).toEqual(['/n must be integer or null, got number']);
    expect(errs({ version: 1, n: 11 })).toEqual(['/n must be ≤ 10']);
    expect(errs({ version: 1, kind: 'c' })).toEqual(['/kind must be one of "a", "b"']);
    expect(errs({ version: 1, list: [{ id: 'x' }, {}, {}] })).toEqual([
      '/list must have at most 2 items',
      '/list/0/id must be integer, got string',
      '/list/1 missing required property "id"',
      '/list/2 missing required property "id"',
    ]);
    expect(errs({ version: 1, byName: { lobby: true, Wall: 'yes' } })).toEqual(['/byName unknown property "lobby"', '/byName/Wall must be boolean, got string']);
  });

  it('caps the number of errors', () => {
    expect(validate({ type: 'array', items: { type: 'string' } }, Array(50).fill(1), 5)).toHaveLength(5);
  });
});

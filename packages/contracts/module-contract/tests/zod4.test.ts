import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { flashSchema, moduleManifestSchema } from '../dist/index.js';
import { MAX_CONTRACT_COLLECTION_ITEMS } from '../dist/schema-limits.js';

test('bounded contract collections reject oversized input before validating elements', () => {
  const valid = { level: 'info', message: 'message' };
  expect(flashSchema.safeParse(Array(MAX_CONTRACT_COLLECTION_ITEMS).fill(valid)).success).toBe(
    true,
  );
  for (const schema of [flashSchema, moduleManifestSchema.shape.routes.unwrap()]) {
    const result = schema.safeParse(Array(MAX_CONTRACT_COLLECTION_ITEMS + 1).fill(null));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0].code).toBe('too_big');
    }
  }
});

test('native JSON schemas retain Draft 7 identities, defaults and resolvable references', async () => {
  for (const name of [
    'module-manifest',
    'route-definition',
    'route-input',
    'route-output',
    'view-definition',
    'module-error',
  ]) {
    const json = JSON.parse(
      await readFile(new URL(`../schema/${name}.schema.json`, import.meta.url), 'utf8'),
    );
    expect(json.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(json.$ref).toBe(`#/definitions/${name}`);
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (typeof record.$ref === 'string') {
        const ref = record.$ref;
        expect(ref.startsWith('#/')).toBe(true);
        let target: unknown = json;
        for (const key of ref.slice(2).split('/')) {
          target = (target as Record<string, unknown>)?.[
            key.replace(/~1/g, '/').replace(/~0/g, '~')
          ];
        }
        expect(target).toBeDefined();
      }
      for (const value of Object.values(record)) visit(value);
    };
    visit(json);
  }
  const input = JSON.parse(
    await readFile(new URL('../schema/route-input.schema.json', import.meta.url), 'utf8'),
  );
  const params = input.definitions['route-input'].properties.params;
  const referenceNode = params.allOf?.[0] ?? params;
  const reference = referenceNode.$ref
    ? input.definitions[referenceNode.$ref.split('/').at(-1)]
    : referenceNode;
  expect(reference.properties.kind.default).toBe('zod');
  expect(reference.required).toContain('name');
  expect(reference.required).not.toContain('kind');
});

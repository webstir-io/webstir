import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { schemaDeclaresField } from '@webstir-io/module-contract';
import {
  checkAttribute,
  checkText,
  declaresKey,
  elementOf,
  flattenSchema,
  isSchemaLike,
  lookupKey,
} from '../dist/render/schema.js';
import { frontendConfigSchema } from '../dist/config/schema.js';

const object = z.object({ title: z.string(), flash: z.array(z.unknown()) });
for (const [name, schema] of [
  ['optional', object.optional()],
  ['nullable', object.nullable()],
  ['default', object.default({ title: 'default', flash: [] })],
  ['prefault', object.prefault({ title: 'default', flash: [] })],
  ['catch', object.catch({ title: 'default', flash: [] })],
  ['readonly', object.readonly()],
  ['refinement', object.refine(() => true)],
  ['nonoptional', object.optional().nonoptional()],
  ['lazy', z.lazy(() => object)],
  ['preprocess', z.preprocess((value) => value, object)],
  ['union', z.union([object, z.object({ title: z.number() })])],
  ['intersection', z.intersection(object, z.object({ other: z.string() }))],
]) {
  test(`Zod 4 ${name} retains field and flash inspection`, () => {
    const leaves = flattenSchema(schema);
    assert.equal(declaresKey(leaves, 'title'), true);
    const result = lookupKey(leaves, 'title');
    assert.ok(result.ok);
    assert.equal(checkText(result.ok), undefined);
    assert.equal(schemaDeclaresField(schema, 'flash'), true);
  });
}

test('Zod 4 records, tuple rest, pipes and open keys retain output semantics', () => {
  const record = lookupKey(flattenSchema(z.record(z.string(), z.number())), 'dynamic');
  assert.equal(checkText(record.ok), undefined);
  const tuple = elementOf(flattenSchema(z.tuple([z.string()]).rest(z.number())));
  assert.equal(checkText(tuple.ok), undefined);
  const piped = z
    .string()
    .transform((title) => ({ title }))
    .pipe(z.object({ title: z.string() }));
  assert.ok(lookupKey(flattenSchema(piped), 'missing').error);
  assert.equal(checkText(flattenSchema(z.string().transform(() => ({})))), undefined);
  assert.ok(lookupKey(flattenSchema(object.passthrough()), 'extra').ok);
  assert.ok(lookupKey(flattenSchema(object.strict()), 'extra').error);
});

test('Zod 4 literal sets check every value and legacy shapes fail loudly', () => {
  assert.match(checkText(flattenSchema(z.literal(['yes', true]))), /needs a string/);
  assert.equal(checkAttribute(flattenSchema(z.literal(['yes', true]))), undefined);
  assert.equal(isSchemaLike({ _def: { typeName: 'ZodAny' } }), false);
  assert.throws(() => flattenSchema({ _def: { typeName: 'ZodAny' } }), /Zod 4/);
});

test('frontend shell defaults still parse nested defaults in Zod 4', () => {
  // Exercise the same nested schema without unrelated required path fields.
  assert.deepEqual(frontendConfigSchema.shape.shell.parse(undefined), { stickyHeader: false });
  assert.deepEqual(frontendConfigSchema.shape.shell.parse({}), { stickyHeader: false });
});

test('custom schemas retain opaque output inspection and BigInt diagnostics stay printable', () => {
  const text = z.custom((value) => typeof value === 'string');
  assert.equal(text.parse('valid'), 'valid');
  assert.equal(checkText(flattenSchema(text)), undefined);
  const customObject = z.custom((value) => typeof value === 'object');
  assert.ok(lookupKey(flattenSchema(customObject), 'title').ok);
  assert.match(checkText(flattenSchema(z.literal([1n, true]))), /literal \[1n, true\]/);
});

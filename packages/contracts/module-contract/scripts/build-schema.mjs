#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  moduleErrorSchema,
  moduleManifestSchema,
  routeDefinitionSchema,
  routeInputSchema,
  routeOutputSchema,
  viewDefinitionSchema
} from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(__dirname, '..', 'schema');

await mkdir(schemaDir, { recursive: true });

const schemaEntries = [
  ['module-manifest', moduleManifestSchema],
  ['route-definition', routeDefinitionSchema],
  ['route-input', routeInputSchema],
  ['route-output', routeOutputSchema],
  ['view-definition', viewDefinitionSchema],
  ['module-error', moduleErrorSchema]
];

const toJson = (name, schema) => {
  const { $schema, definitions, ...definition } = z.toJSONSchema(schema, {
    target: 'draft-07',
    io: 'input',
    reused: 'ref',
    override: ({ zodSchema, jsonSchema }) => {
      // Preserve the published Draft 7 policy for objects that strip extra keys.
      if (zodSchema._zod.def.type === 'object' && !zodSchema._zod.def.catchall) {
        jsonSchema.additionalProperties = false;
      }
    },
  });
  return { $ref: `#/definitions/${name}`, definitions: { ...definitions, [name]: definition }, $schema };
};

await Promise.all(
  schemaEntries.map(async ([name, schema]) => {
    const json = toJson(name, schema);
    const filePath = join(schemaDir, `${name}.schema.json`);
    const contents = `${JSON.stringify(json, null, 2)}\n`;
    await writeFile(filePath, contents, 'utf8');
    console.info(`[module-contract] wrote ${filePath}`);
  })
);

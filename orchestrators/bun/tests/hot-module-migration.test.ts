import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { HOT_MODULE_REGISTRATION, migrateHotModuleRegistry } from '../src/hot-module-migration.ts';
import { packageRoot } from '../src/paths.ts';

const fixturePath = path.join(
  packageRoot,
  'test-support',
  'fixtures',
  'legacy-hot-module-app.ts.txt',
);

test('the scaffold registry block is replaced by the thin registration', async () => {
  const legacy = await readFile(fixturePath, 'utf8');
  const result = migrateHotModuleRegistry(legacy);

  expect(result.kind).toBe('rewritten');
  if (result.kind !== 'rewritten') {
    return;
  }
  expect(result.source).toContain(HOT_MODULE_REGISTRATION);
  expect(result.source).not.toContain('__webstirRegisterHotModule');
  expect(result.source).not.toContain('__webstirDispose');
  expect(result.source).not.toContain('hotModuleRegistry');
  expect(result.source).toContain("import './scripts/components/menu.js';");
  expect(result.source).toContain('async function loadErrorHandler()');
  expect(result.source).toContain('export { loadErrorHandler };');
  expect(migrateHotModuleRegistry(result.source)).toEqual({ kind: 'unchanged' });
});

test('an app entry that never had the registry is left alone', () => {
  expect(migrateHotModuleRegistry("import './scripts/features/client-nav.js';\n")).toEqual({
    kind: 'unchanged',
  });
});

test('a registry block that installs extra hooks is reported, not rewritten', async () => {
  const legacy = await readFile(fixturePath, 'utf8');
  const customized = legacy.replace(
    'window.__webstirRegisterHotModule = registerHotModule;',
    'window.__webstirRegisterHotModule = registerHotModule;\nwindow.__webstirRegisterHotBoundary = () => {};',
  );

  const result = migrateHotModuleRegistry(customized);
  expect(result.kind).toBe('customized');
  if (result.kind === 'customized') {
    expect(result.reason).toContain('__webstirRegisterHotBoundary');
  }
});

test('code that still uses a registry helper blocks the rewrite', async () => {
  const legacy = await readFile(fixturePath, 'utf8');
  const customized = `${legacy}\nexport const keep = normalizeModuleId('x');\n`;

  const result = migrateHotModuleRegistry(customized);
  expect(result.kind).toBe('customized');
  if (result.kind === 'customized') {
    expect(result.reason).toContain('normalizeModuleId');
  }
});

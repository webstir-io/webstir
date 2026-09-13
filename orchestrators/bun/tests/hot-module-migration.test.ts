import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  HOT_MODULE_REGISTRATION,
  classifyHmrClient,
  migrateHotModuleRegistry,
} from '../src/hot-module-migration.ts';
import { packageRoot } from '../src/paths.ts';

const fixturesRoot = path.join(packageRoot, 'test-support', 'fixtures');
const legacyAppPath = path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt');
const legacySsgClientPath = path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt');
const legacySpaClientPath = path.join(fixturesRoot, 'legacy-hmr-client-spa.js.txt');
const currentClientPath = path.join(
  packageRoot,
  'assets',
  'templates',
  'ssg',
  'src',
  'frontend',
  'app',
  'hmr.js',
);

test('the scaffold registry block is replaced by the thin registration', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
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

test('Windows line endings still match the scaffold', async () => {
  const legacy = (await readFile(legacyAppPath, 'utf8')).replaceAll('\n', '\r\n');
  expect(migrateHotModuleRegistry(legacy).kind).toBe('rewritten');
});

test('any edit inside the types block blocks the rewrite', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
  const customized = legacy.replace(
    'const hotModuleRegistry = new Map<string, HotModuleRecord>();',
    'const hotModuleRegistry = new Map<string, HotModuleRecord>();\nconst bootedAt = Date.now();',
  );
  expect(customized).not.toBe(legacy);

  const result = migrateHotModuleRegistry(customized);
  expect(result.kind).toBe('customized');
  if (result.kind === 'customized') {
    expect(result.reason).toContain('types block differs');
  }
});

test('custom disposal logic inside the registry block blocks the rewrite', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
  const customized = legacy.replace(
    '  const contextWithHistory = withHistoryContext(context, record);\n\n  try {\n    const result = record.dispose(contextWithHistory);',
    "  const contextWithHistory = withHistoryContext(context, record);\n\n  try {\n    console.debug('disposing', moduleId);\n    const result = record.dispose(contextWithHistory);",
  );
  expect(customized).not.toBe(legacy);

  const result = migrateHotModuleRegistry(customized);
  expect(result.kind).toBe('customized');
  if (result.kind === 'customized') {
    expect(result.reason).toContain('registry block differs');
  }
});

test('an extra hook in the registry block blocks the rewrite', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
  const customized = legacy.replace(
    'window.__webstirRegisterHotModule = registerHotModule;',
    'window.__webstirRegisterHotModule = registerHotModule;\nwindow.__webstirRegisterHotBoundary = () => {};',
  );

  expect(migrateHotModuleRegistry(customized).kind).toBe('customized');
});

test('a helper still used outside the registry blocks the rewrite', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
  const customized = `${legacy}\nexport const keep = normalizeModuleId('/docs');\n`;

  const result = migrateHotModuleRegistry(customized);
  expect(result.kind).toBe('customized');
  if (result.kind === 'customized') {
    expect(result.reason).toContain('normalizeModuleId');
  }
});

test('an entry that dropped only the registration hook is still legacy, and customized', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
  const customized = legacy.replace('window.__webstirRegisterHotModule = registerHotModule;\n', '');
  expect(customized).not.toBe(legacy);

  const result = migrateHotModuleRegistry(customized);
  expect(result.kind).toBe('customized');
  if (result.kind === 'customized') {
    expect(result.reason).toContain('registry block differs');
  }
});

test('the client is recognized as current, legacy, or custom', async () => {
  const current = await readFile(currentClientPath, 'utf8');
  expect(classifyHmrClient(current, current)).toBe('current');
  expect(classifyHmrClient(await readFile(legacySsgClientPath, 'utf8'), current)).toBe('legacy');
  expect(classifyHmrClient(await readFile(legacySpaClientPath, 'utf8'), current)).toBe('legacy');
  expect(classifyHmrClient(`${current}\nconsole.log('mine');\n`, current)).toBe('custom');
  expect(
    classifyHmrClient(
      (await readFile(legacySsgClientPath, 'utf8')).replaceAll('\n', '\r\n'),
      current,
    ),
  ).toBe('legacy');
});

import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isShippedDevClient } from '../src/dev-client-copies.ts';
import { HOT_MODULE_REGISTRATION, migrateHotModuleRegistry } from '../src/hot-module-migration.ts';
import { packageRoot } from '../src/paths.ts';

const fixturesRoot = path.join(packageRoot, 'test-support', 'fixtures');
const legacyAppPath = path.join(fixturesRoot, 'legacy-hot-module-app.ts.txt');
const legacySsgClientPath = path.join(fixturesRoot, 'legacy-hmr-client-ssg.js.txt');
const legacySpaClientPath = path.join(fixturesRoot, 'legacy-hmr-client-spa.js.txt');
const packagedClient = (name: string) =>
  path.join(
    packageRoot,
    '..',
    '..',
    'packages',
    'tooling',
    'webstir-frontend',
    'src',
    'dev-clients',
    name,
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

test('a modifier added to a scaffold declaration reads as customization', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
  const customized = legacy.replace('\ntype HotAsset = {', '\nexport type HotAsset = {');
  expect(customized).not.toBe(legacy);

  const result = migrateHotModuleRegistry(customized);
  expect(result.kind).toBe('customized');
  if (result.kind === 'customized') {
    expect(result.reason).toContain('not laid out');
  }
});

test('the rewritten entry is valid TypeScript', async () => {
  const legacy = await readFile(legacyAppPath, 'utf8');
  const result = migrateHotModuleRegistry(legacy);
  expect(result.kind).toBe('rewritten');
  if (result.kind !== 'rewritten') {
    return;
  }
  const transpiler = new Bun.Transpiler({ loader: 'ts' });
  expect(() => transpiler.transformSync(result.source)).not.toThrow();
  expect(result.source).not.toContain('export export');
});

test('every dev client a scaffold shipped is recognized, and an edited one is not', async () => {
  const cases: Array<[name: string, source: string, shipped: boolean]> = [];
  for (const name of ['hmr.js', 'refresh.js']) {
    const current = await readFile(packagedClient(name), 'utf8');
    cases.push([name, current, true], [name, current.replaceAll('\n', '\r\n'), true]);
    cases.push([name, `${current}\nconsole.log('mine');\n`, false]);
  }
  for (const legacy of [legacySsgClientPath, legacySpaClientPath]) {
    cases.push(['hmr.js', await readFile(legacy, 'utf8'), true]);
  }
  for (const [name, source, shipped] of cases) {
    expect({ name, shipped: isShippedDevClient(name, source) }).toEqual({ name, shipped });
  }
});

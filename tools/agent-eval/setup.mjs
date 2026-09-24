import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execute } from './process.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
export const repository = path.resolve(root, '../..');
export async function outsideRepository(directory) {
  await mkdir(directory, { recursive: true });
  const resolved = await realpath(directory);
  if (resolved === repository || resolved.startsWith(`${repository}${path.sep}`))
    throw new Error('Evaluation workspaces/results must be outside the monorepo.');
  return resolved;
}
export async function fingerprint() {
  const files = [
    'tasks.mjs',
    'grade.mjs',
    'process.mjs',
    'setup.mjs',
    'run.mjs',
    'regrade.mjs',
    'fixtures/module.ts',
    'fixtures/notes.test.ts',
    'README.md',
  ];
  const hash = createHash('sha256');
  for (const name of files) hash.update(name).update(await readFile(path.join(root, name)));
  return hash.digest('hex');
}
export async function install(directory, packageSpec, dependencies = {}) {
  await mkdir(directory, { recursive: true });
  const spec = /^\d+\.\d+\.\d+/.test(packageSpec)
    ? packageSpec
    : packageSpec.startsWith('@')
      ? packageSpec.split('@').at(-1)
      : path.resolve(packageSpec);
  await writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify({ name: 'webstir-evaluation-install', private: true, dependencies: { '@webstir-io/webstir': spec, ...dependencies }, overrides: dependencies }, null, 2)}\n`,
  );
  const result = await execute('bun', ['install'], {
    cwd: directory,
    timeoutMs: 120000,
    log: path.join(directory, 'install.log'),
  });
  if (result.code !== 0) throw new Error(`Package installation failed: ${result.tail}`);
  return {
    cli: path.join(directory, 'node_modules/.bin/webstir'),
    versions: await installedVersions(directory),
    spec,
  };
}
export async function installedVersions(directory) {
  const cliManifest = path.join(directory, 'node_modules/@webstir-io/webstir/package.json');
  const resolveFromCli = createRequire(cliManifest);
  const versions = {};
  for (const name of [
    '@webstir-io/webstir',
    '@webstir-io/webstir-backend',
    '@webstir-io/webstir-frontend',
    '@webstir-io/webstir-testing',
    '@webstir-io/module-contract',
    '@webstir-io/testing-contract',
  ]) {
    const manifest = JSON.parse(
      await readFile(
        name === '@webstir-io/webstir'
          ? cliManifest
          : resolveFromCli.resolve(`${name}/package.json`),
        'utf8',
      ),
    );
    if (manifest.name !== name)
      throw new Error(`Resolved wrong package for ${name}: ${manifest.name}`);
    versions[name] = manifest.version;
  }
  return versions;
}
export async function assertFreshRuns(directories, { grading = false } = {}) {
  if (new Set(directories.map((directory) => path.resolve(directory))).size !== directories.length)
    throw new Error('Multiple trials target the same run directory.');
  for (const directory of directories) {
    for (const name of grading
      ? ['evidence/result.json']
      : ['app', 'evidence/result.json', 'evidence/prepared.json']) {
      const file = path.join(directory, name);
      try {
        await lstat(file);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      throw new Error(`Refusing to overwrite existing trial evidence: ${file}`);
    }
  }
}
export async function prepare({
  task,
  workspace,
  cli,
  evidence,
  dependencies = {},
  pristine = false,
}) {
  await mkdir(workspace, { recursive: true });
  await mkdir(evidence, { recursive: true });
  if (task === 'build') return;
  const init = await execute('bun', [cli, 'init', 'full', workspace], {
    cwd: workspace,
    timeoutMs: 60000,
    log: path.join(evidence, 'setup.log'),
  });
  if (init.code !== 0) throw new Error(`Scaffold failed: ${init.tail}`);
  const manifestPath = path.join(workspace, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (Object.keys(dependencies).length) manifest.overrides = dependencies;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const installed = await execute('bun', ['install'], {
    cwd: workspace,
    timeoutMs: 120000,
    log: path.join(evidence, 'setup.log'),
  });
  if (installed.code !== 0)
    throw new Error(`App dependency installation failed: ${installed.tail}`);
  let module = await readFile(path.join(root, 'fixtures/module.ts'), 'utf8');
  if (!pristine && task === 'repair')
    module = module.replace(
      'entry.id === values.id && entry.owner === current.owner',
      "entry.id === (operation === 'update' ? values.noteId : values.id) && entry.owner === current.owner",
    );
  if (!pristine && task === 'holdout')
    module = module.replace(
      'entry.id === values.id && entry.owner === current.owner',
      "entry.id === (operation === 'delete' ? values.noteId : values.id) && entry.owner === current.owner",
    );
  await writeFile(path.join(workspace, 'src/backend/module.ts'), module);
  await rm(path.join(workspace, 'src/backend/tests/progressive-enhancement.test.ts'));
  await writeFile(
    path.join(workspace, 'src/backend/tests/notes.test.ts'),
    await readFile(path.join(root, 'fixtures/notes.test.ts')),
  );
  for (const name of [
    'src/frontend/pages/home/index.html',
    'src/frontend/pages/home/tests/home.test.ts',
  ]) {
    const file = path.join(workspace, name);
    await writeFile(
      file,
      (await readFile(file, 'utf8')).replaceAll('/api/demo/progressive-enhancement', '/api/notes'),
    );
  }
  const stylesheet = path.join(workspace, 'src/frontend/app/app.css');
  await writeFile(
    stylesheet,
    `${await readFile(stylesheet, 'utf8')}\n/* Cedar team customization. */\n:root { --cedar-accent: #315d44; }\n`,
  );
  const managed = path.join(workspace, 'src/frontend/app/hmr.js');
  const expected = await readFile(managed, 'utf8');
  await writeFile(
    path.join(evidence, 'fixture.json'),
    `${JSON.stringify({ managedFileSha256: createHash('sha256').update(expected).digest('hex') }, null, 2)}\n`,
  );
  if (!pristine && ['repair', 'holdout'].includes(task)) await rm(managed);
}

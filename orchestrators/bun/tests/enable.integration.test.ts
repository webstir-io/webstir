import { expect, test } from 'bun:test';
import os from 'node:os';
import path from 'node:path';
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import { materializeRepoLocalWorkspaceDependencies } from '../src/external-workspace.ts';
import { packageRoot, repoRoot } from '../src/paths.ts';
import { copyDemoWorkspace, removeDemoWorkspace } from '../test-support/demo-workspace.ts';

function decodeOutput(buffer: Uint8Array | undefined): string {
  return new TextDecoder().decode(buffer ?? new Uint8Array());
}

async function runEnableInWorkspace(
  copiedWorkspace: string,
  featureArgs: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      'enable',
      ...featureArgs,
      '--workspace',
      copiedWorkspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

async function runWorkspaceCli(
  copiedWorkspace: string,
  args: readonly string[],
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> {
  const processResult = Bun.spawnSync({
    cmd: [
      process.execPath,
      path.join(packageRoot, 'src', 'cli.ts'),
      ...args,
      '--workspace',
      copiedWorkspace,
    ],
    cwd: repoRoot,
    env: process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdout: decodeOutput(processResult.stdout),
    stderr: decodeOutput(processResult.stderr),
    exitCode: processResult.exitCode,
  };
}

type EnableWorkspacePackageJson = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  webstir: {
    mode: string;
    enable: {
      search: boolean;
      clientNav: boolean;
      githubPages: boolean;
      s3CloudFront: boolean;
    };
  };
  scripts: {
    deploy: string;
  };
};

async function readJsonFile(filePath: string): Promise<EnableWorkspacePackageJson> {
  return JSON.parse(await readFile(filePath, 'utf8')) as EnableWorkspacePackageJson;
}

test('CLI enables search on the SSG demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['search']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('[webstir] enable complete');
  expect(result.stdout).toContain('feature: search');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const appTs = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.ts'),
    'utf8',
  );
  const appCss = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.css'),
    'utf8',
  );
  const appHtml = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.html'),
    'utf8',
  );

  expect(packageJson.webstir.enable.search).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'search.ts',
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'styles',
        'features',
        'search.css',
      ),
    ),
  ).toBe(true);
  expect(appTs).toContain('import "./scripts/features/search.js";');
  expect(appCss).toContain(
    '@layer reset, tokens, base, layout, components, features, utilities, overrides;',
  );
  expect(appCss).toContain('@import "./styles/features/search.css";');
  expect(appHtml).toContain('<html data-webstir-search-styles="css" lang="en">');
});

test('CLI enables client-nav and copies the fragment helper asset', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['client-nav']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: client-nav');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const appTs = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app', 'app.ts'),
    'utf8',
  );

  expect(packageJson.webstir.enable.clientNav).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'client-nav.ts',
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'form-enhancement.ts',
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      path.join(
        copiedWorkspace.workspaceRoot,
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'document-navigation.ts',
      ),
    ),
  ).toBe(true);
  expect(appTs).toContain('import "./scripts/features/client-nav.js";');
});

test('CLI enables backend on the SPA demo workspace end to end', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-enable-spa-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['backend']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: backend');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const baseTsconfig = await readJsonFile(
    path.join(copiedWorkspace.workspaceRoot, 'base.tsconfig.json'),
  );

  expect(packageJson.webstir.mode).toBe('full');
  expect(packageJson.webstir.enable.backend).toBe(true);
  expect(packageJson.dependencies['@webstir-io/webstir-backend']).toBe('workspace:*');
  expect(packageJson.dependencies.pino).toBe('^10.1.0');
  expect(packageJson.devDependencies['@types/bun']).toBe('^1.3.11');
  expect(existsSync(path.join(copiedWorkspace.workspaceRoot, 'src', 'backend', 'index.ts'))).toBe(
    true,
  );
  expect(baseTsconfig.references).toContainEqual({ path: 'src/backend' });

  const repairResult = await runWorkspaceCli(copiedWorkspace.workspaceRoot, [
    'repair',
    '--dry-run',
    '--json',
  ]);
  const repair = JSON.parse(repairResult.stdout) as { changes: string[] };
  expect(repairResult.exitCode).toBe(0);
  expect(repairResult.stderr).toBe('');
  expect(repair.changes).not.toContain('src/backend/tests/progressive-enhancement.test.ts');
  expect(repair.changes.some((change) => change.startsWith('src/backend/'))).toBe(false);
});

test('CLI enables gh-deploy with Bun-native deploy scaffolding', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
    'gh-deploy',
    'demo-site',
  ]);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: gh-deploy');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const frontendConfig = await readJsonFile(
    path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'frontend.config.json'),
  );
  const deployScript = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'utils', 'deploy-gh-pages.sh'),
    'utf8',
  );
  const workflow = await readFile(
    path.join(copiedWorkspace.workspaceRoot, '.github', 'workflows', 'webstir-gh-pages.yml'),
    'utf8',
  );

  expect(packageJson.webstir.enable.githubPages).toBe(true);
  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-gh-pages.sh');
  expect(frontendConfig.publish.basePath).toBe('/demo-site');
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" build -w "$ROOT_DIR"',
  );
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" publish -w "$ROOT_DIR" -m ssg',
  );
  expect(workflow).toContain('uses: oven-sh/setup-bun@v2');
  expect(workflow).toContain('run: bun run deploy');
});

test('CLI enables s3-cloudfront with a deploy script, edge function, and workflow', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['s3-cloudfront']);

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('feature: s3-cloudfront');

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const deployScript = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'utils', 'deploy-s3-cloudfront.sh'),
    'utf8',
  );
  const edgeFunction = await readFile(
    path.join(copiedWorkspace.workspaceRoot, 'utils', 'cloudfront-rewrite-directory-index.js'),
    'utf8',
  );
  const workflow = await readFile(
    path.join(copiedWorkspace.workspaceRoot, '.github', 'workflows', 'webstir-s3-cloudfront.yml'),
    'utf8',
  );

  expect(packageJson.webstir.enable.s3CloudFront).toBe(true);
  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-s3-cloudfront.sh');
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" build -w "$ROOT_DIR"',
  );
  expect(deployScript).toContain(
    'bun "$ROOT_DIR/node_modules/@webstir-io/webstir-frontend/dist/cli.js" publish -w "$ROOT_DIR" -m ssg',
  );
  expect(deployScript).toContain('--cache-control "$IMMUTABLE_CACHE"');
  expect(deployScript).toContain('--cache-control "$DOCUMENT_CACHE"');
  expect(deployScript).toContain('aws cloudfront create-invalidation');
  expect(edgeFunction).toContain("request.uri = uri + 'index.html';");
  expect(workflow).toContain('uses: aws-actions/configure-aws-credentials@v4');
  expect(workflow).toContain(`S3_BUCKET: \${{ vars.S3_BUCKET }}`);
  expect(workflow).toContain('run: bash ./utils/deploy-s3-cloudfront.sh');
  expect(
    existsSync(path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'frontend.config.json')),
  ).toBe(false);

  const secondRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['s3-cloudfront']);
  expect(secondRun.exitCode).toBe(0);
  expect(secondRun.stdout).not.toContain('webstir-s3-cloudfront.yml');
});

test('CLI s3-cloudfront keeps an existing deploy command and the workflow still runs its own script', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const pages = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['gh-deploy', 'demo']);
  expect(pages.exitCode).toBe(0);
  const s3 = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['s3-cloudfront']);
  expect(s3.exitCode).toBe(0);

  const packageJson = await readJsonFile(path.join(copiedWorkspace.workspaceRoot, 'package.json'));
  const workflow = await readFile(
    path.join(copiedWorkspace.workspaceRoot, '.github', 'workflows', 'webstir-s3-cloudfront.yml'),
    'utf8',
  );

  expect(packageJson.scripts.deploy).toBe('bash ./utils/deploy-gh-pages.sh');
  expect(packageJson.webstir.enable.s3CloudFront).toBe(true);
  expect(workflow).toContain('run: bash ./utils/deploy-s3-cloudfront.sh');
  expect(workflow).not.toContain('bun run deploy');
});

test('generated s3-cloudfront script publishes from a clean checkout and retains bundles by last publish', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const workspace = copiedWorkspace.workspaceRoot;
  const enable = await runEnableInWorkspace(workspace, ['s3-cloudfront']);
  expect(enable.exitCode).toBe(0);
  await materializeRepoLocalWorkspaceDependencies(workspace, { installStdio: 'pipe' });

  await rm(path.join(workspace, 'build'), { recursive: true, force: true });
  await rm(path.join(workspace, 'dist'), { recursive: true, force: true });
  await rm(path.join(workspace, '.webstir'), { recursive: true, force: true });

  const stubDir = await mkdtemp(path.join(os.tmpdir(), 'webstir-aws-stub-'));
  await mkdir(path.join(stubDir, 'manifests'), { recursive: true });
  // Fake bucket state: MONTHOLD was uploaded long ago but the previous publish still served it.
  await writeFile(
    path.join(stubDir, 'aws'),
    [
      '#!/usr/bin/env bash',
      'printf \'%s\\n\' "$*" >> "$AWS_STUB_LOG"',
      'PREFIX="s3://example-bucket/.webstir-deploys/"',
      'if [[ "$1 $2" == "s3 cp" && "$4" == "$PREFIX"* ]]; then',
      '  cp "$3" "$AWS_STUB_DIR/manifests/$(basename "$4")"',
      'elif [[ "$1 $2" == "s3 cp" && "$3" == "$PREFIX"* && "$4" == "-" ]]; then',
      '  name="$(basename "$3")"',
      '  case "$name" in',
      '    19990101T000000Z.txt) echo "app/app-ANCIENT0.js" ;;',
      '    20000101T000000Z.txt) echo "app/app-MONTHOLD.js" ;;',
      '    29990101T000000Z.txt) echo "home/index-NEWNEW01.js" ;;',
      '    *) cat "$AWS_STUB_DIR/manifests/$name" ;;',
      '  esac',
      'elif [[ "$1 $2" == "s3 ls" && "$3" == "$PREFIX" ]]; then',
      '  if [[ "$AWS_STUB_HISTORY" == "busy" ]]; then',
      '    echo "1999-01-01 00:00:00     100 19990101T000000Z.txt"',
      '    echo "2000-01-01 00:00:00     100 20000101T000000Z.txt"',
      '    echo "2999-01-01 00:00:00     100 29990101T000000Z.txt"',
      '  elif [[ "$AWS_STUB_HISTORY" == "quiet" ]]; then',
      '    echo "2000-01-01 00:00:00     100 20000101T000000Z.txt"',
      '  fi',
      '  for f in "$AWS_STUB_DIR"/manifests/*; do echo "2999-01-01 00:00:00     100 $(basename "$f")"; done',
      'elif [[ "$1 $2" == "s3 ls" && "$4" == "--recursive" ]]; then',
      '  echo "1999-01-01 00:00:00     100 app/app-ANCIENT0.js"',
      '  echo "2000-01-01 00:00:00     100 app/app-MONTHOLD.js"',
      '  echo "2000-01-01 00:00:00     100 app/app-OLDOLD01.js"',
      '  echo "2999-01-01 00:00:00     100 home/index-NEWNEW01.js"',
      '  echo "2000-01-01 00:00:00     100 index.html"',
      '  (cd "$DIST_DIR" && find . -name "*-????????.js" -o -name "*-????????.css" | sed "s|^\\./|2000-01-01 00:00:00     100 |")',
      'fi',
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o755 },
  );

  async function runDeploy(history: 'busy' | 'quiet' | 'no'): Promise<string[]> {
    const callLog = path.join(stubDir, `calls-${history}.log`);
    await rm(path.join(stubDir, 'manifests'), { recursive: true, force: true });
    await mkdir(path.join(stubDir, 'manifests'), { recursive: true });
    const run = Bun.spawnSync({
      cmd: ['bash', path.join(workspace, 'utils', 'deploy-s3-cloudfront.sh')],
      cwd: workspace,
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH ?? ''}`,
        AWS_STUB_LOG: callLog,
        AWS_STUB_DIR: stubDir,
        AWS_STUB_HISTORY: history,
        DIST_DIR: path.join(workspace, 'dist', 'frontend'),
        S3_BUCKET: 'example-bucket',
        CLOUDFRONT_DISTRIBUTION_ID: 'EXAMPLE',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = decodeOutput(run.stdout);
    const stderr = decodeOutput(run.stderr);
    expect(run.exitCode, `stdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0);
    return (await readFile(callLog, 'utf8')).trim().split('\n');
  }

  const calls = await runDeploy('busy');
  expect(existsSync(path.join(workspace, 'dist', 'frontend', 'index.html'))).toBe(true);

  const syncs = calls.filter((call) => call.startsWith('s3 sync '));
  expect(syncs).toHaveLength(2);
  expect(syncs[0]).not.toContain('--delete');
  expect(syncs[0]).toContain('--include *-????????.js');
  expect(syncs[1]).toContain('--delete');
  expect(syncs[1]).toContain('--exclude *-????????.js');
  expect(syncs[1]).toContain('--exclude .webstir-deploys/*');

  const headIndex = calls.findIndex((call) => call.startsWith('s3api head-object'));
  const manifestIndex = calls.findIndex((call) =>
    /^s3 cp \S+ s3:\/\/example-bucket\/\.webstir-deploys\/\d{8}T\d{6}Z\.txt/.test(call),
  );
  const invalidateIndex = calls.findIndex((call) =>
    call.startsWith('cloudfront create-invalidation'),
  );
  expect(headIndex).toBeGreaterThan(calls.indexOf(syncs[1] ?? ''));
  expect(manifestIndex).toBeGreaterThan(headIndex);
  expect(invalidateIndex).toBeGreaterThan(manifestIndex);
  expect(calls[invalidateIndex]).toContain('--distribution-id EXAMPLE');

  const removals = calls.filter((call) => call.startsWith('s3 rm ')).sort();
  // Busy history: 1999 and 2000 both predate the cutoff, but the 2000 release was the
  // one live when the window began, so it and its bundle stay. Only the release it
  // replaced (1999) and bundles no active release referenced are removed.
  expect(removals).toEqual([
    's3 rm s3://example-bucket/.webstir-deploys/19990101T000000Z.txt',
    's3 rm s3://example-bucket/app/app-ANCIENT0.js',
    's3 rm s3://example-bucket/app/app-OLDOLD01.js',
  ]);
  expect(calls.findIndex((call) => call.startsWith('s3 rm '))).toBeGreaterThan(invalidateIndex);

  // Quiet period: one release published long before the cutoff and live until this
  // deploy. Its manifest and bundle must survive; only unreferenced bundles go.
  const quiet = await runDeploy('quiet');
  expect(quiet.filter((call) => call.startsWith('s3 rm ')).sort()).toEqual([
    's3 rm s3://example-bucket/app/app-ANCIENT0.js',
    's3 rm s3://example-bucket/app/app-OLDOLD01.js',
    's3 rm s3://example-bucket/home/index-NEWNEW01.js',
  ]);

  // With no publish history, nothing is ever removed.
  const firstRun = await runDeploy('no');
  expect(firstRun.some((call) => call.startsWith('s3 rm '))).toBe(false);

  await rm(stubDir, { recursive: true, force: true });
}, 120_000);

test('CLI enables page scripts once and rejects duplicate scaffold attempts', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-ssg-base-');
  const firstRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
    'scripts',
    '  home  ',
  ]);

  expect(firstRun.exitCode).toBe(0);
  expect(firstRun.stderr).toBe('');
  expect(
    existsSync(
      path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.ts'),
    ),
  ).toBe(true);

  const secondRun = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['scripts', 'home']);
  expect(secondRun.exitCode).toBe(1);
  expect(secondRun.stderr).toContain('already has an index.ts script');
});

test('CLI rejects unsafe page script names without touching the workspace or outside files', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-scripts-safe-');
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'webstir-enable-scripts-outside-'));
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const pagesRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    const traversalName = path.relative(pagesRoot, externalRoot).split(path.sep).join('/');
    for (const pageName of [
      traversalName,
      traversalName.replaceAll('/', '\\'),
      '.',
      '..',
      'bad\nname',
      'home\n',
      '\thome',
      'foo:bar',
      'NUL',
      'COM¹.txt',
    ]) {
      const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
        'scripts',
        pageName,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Invalid page name');
    }

    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'index.ts'))).toBe(false);
    expect(
      existsSync(
        path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages', 'home', 'index.ts'),
      ),
    ).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI rejects symlinked page script ancestors and targets without following them', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-scripts-symlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-scripts-symlink-outside-'),
  );
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  const linkedTargetPath = path.join(externalRoot, 'linked-index.ts');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');
  await writeFile(linkedTargetPath, 'target-sentinel', 'utf8');

  try {
    const pagesRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'pages');
    const linkedPagePath = path.join(pagesRoot, 'linked-page');
    await symlink(externalRoot, linkedPagePath, 'dir');

    const ancestorResult = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
      'scripts',
      'linked-page',
    ]);
    expect(ancestorResult.exitCode).toBe(1);
    expect(ancestorResult.stderr).toContain('symbolic link');
    expect(existsSync(path.join(externalRoot, 'index.ts'))).toBe(false);

    const homeRoot = path.join(pagesRoot, 'home');
    await mkdir(homeRoot, { recursive: true });
    await symlink(linkedTargetPath, path.join(homeRoot, 'index.ts'), 'file');

    const targetResult = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, [
      'scripts',
      'home',
    ]);
    expect(targetResult.exitCode).toBe(1);
    expect(targetResult.stderr).toContain('symbolic link');

    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(await readFile(linkedTargetPath, 'utf8')).toBe('target-sentinel');
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI enable backend rejects a symlinked scaffold ancestor before external writes', async () => {
  const copiedWorkspace = await copyDemoWorkspace('spa', 'webstir-enable-backend-symlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-backend-symlink-outside-'),
  );
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const packageJson = await readFile(packageJsonPath, 'utf8');
  const sentinelPath = path.join(externalRoot, 'sentinel.txt');
  await writeFile(sentinelPath, 'outside-sentinel', 'utf8');

  try {
    await rm(path.join(copiedWorkspace.workspaceRoot, 'src'), { recursive: true, force: true });
    await symlink(externalRoot, path.join(copiedWorkspace.workspaceRoot, 'src'), 'dir');

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['backend']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(packageJson);
    expect(await readFile(sentinelPath, 'utf8')).toBe('outside-sentinel');
    expect(existsSync(path.join(externalRoot, 'backend', 'index.ts'))).toBe(false);
    expect(existsSync(path.join(externalRoot, 'backend', 'env.ts'))).toBe(false);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI enable search rejects symlinked overwrite targets before changing any asset', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-search-symlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-search-symlink-outside-'),
  );
  const externalStyles = path.join(externalRoot, 'styles');
  const externalStyle = path.join(externalStyles, 'search.css');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appRoot, 'app.ts');
  const appCssPath = path.join(appRoot, 'app.css');
  const appHtmlPath = path.join(appRoot, 'app.html');
  const before = {
    packageJson: await readFile(packageJsonPath, 'utf8'),
    appTs: await readFile(appTsPath, 'utf8'),
    appCss: await readFile(appCssPath, 'utf8'),
    appHtml: await readFile(appHtmlPath, 'utf8'),
  };

  await mkdir(externalStyles, { recursive: true });
  await writeFile(externalStyle, 'style-sentinel', 'utf8');

  try {
    const stylesTarget = path.join(appRoot, 'styles', 'features');
    await rm(stylesTarget, { recursive: true, force: true });
    await symlink(externalStyles, stylesTarget, 'dir');

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['search']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('symbolic link');
    expect(existsSync(path.join(appRoot, 'scripts', 'features', 'search.ts'))).toBe(false);
    expect(await readFile(externalStyle, 'utf8')).toBe('style-sentinel');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(before.packageJson);
    expect(await readFile(appTsPath, 'utf8')).toBe(before.appTs);
    expect(await readFile(appCssPath, 'utf8')).toBe(before.appCss);
    expect(await readFile(appHtmlPath, 'utf8')).toBe(before.appHtml);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('CLI enable search rejects hard-linked overwrite targets before changing any asset', async () => {
  const copiedWorkspace = await copyDemoWorkspace('ssg/base', 'webstir-enable-search-hardlink-');
  const externalRoot = await mkdtemp(
    path.join(os.tmpdir(), 'webstir-enable-search-hardlink-outside-'),
  );
  const externalStyle = path.join(externalRoot, 'search.css');
  const packageJsonPath = path.join(copiedWorkspace.workspaceRoot, 'package.json');
  const appRoot = path.join(copiedWorkspace.workspaceRoot, 'src', 'frontend', 'app');
  const appTsPath = path.join(appRoot, 'app.ts');
  const appCssPath = path.join(appRoot, 'app.css');
  const appHtmlPath = path.join(appRoot, 'app.html');
  const targetStyle = path.join(appRoot, 'styles', 'features', 'search.css');
  const before = {
    packageJson: await readFile(packageJsonPath, 'utf8'),
    appTs: await readFile(appTsPath, 'utf8'),
    appCss: await readFile(appCssPath, 'utf8'),
    appHtml: await readFile(appHtmlPath, 'utf8'),
  };

  try {
    await writeFile(externalStyle, 'hard-link-sentinel', 'utf8');
    await mkdir(path.dirname(targetStyle), { recursive: true });
    await rm(targetStyle, { force: true });
    await link(externalStyle, targetStyle);

    const result = await runEnableInWorkspace(copiedWorkspace.workspaceRoot, ['search']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('multiple hard links');
    expect(existsSync(path.join(appRoot, 'scripts', 'features', 'search.ts'))).toBe(false);
    expect(await readFile(externalStyle, 'utf8')).toBe('hard-link-sentinel');
    expect(await readFile(packageJsonPath, 'utf8')).toBe(before.packageJson);
    expect(await readFile(appTsPath, 'utf8')).toBe(before.appTs);
    expect(await readFile(appCssPath, 'utf8')).toBe(before.appCss);
    expect(await readFile(appHtmlPath, 'utf8')).toBe(before.appHtml);
  } finally {
    await removeDemoWorkspace(copiedWorkspace);
    await rm(externalRoot, { recursive: true, force: true });
  }
});

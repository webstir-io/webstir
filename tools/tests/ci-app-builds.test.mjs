import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveCiAppBuilds } from '../resolve-ci-app-builds.mjs';

test('non-PR events always build hub and portal apps', () => {
  const result = resolveCiAppBuilds({
    eventName: 'push',
    changedFiles: [],
  });

  assert.deepEqual(result, {
    buildHub: true,
    buildPortal: true,
    testModuleContract: true,
    testReleaseTools: true,
    testTestingContract: true,
  });
});

test('PRs touching only portal files build only the portal app', () => {
  const result = resolveCiAppBuilds({
    eventName: 'pull_request',
    changedFiles: ['apps/portal/src/pages/index.tsx'],
  });

  assert.deepEqual(result, {
    buildHub: false,
    buildPortal: true,
    testModuleContract: false,
    testReleaseTools: false,
    testTestingContract: false,
  });
});

test('PRs touching frontend tooling build only the hub app', () => {
  const result = resolveCiAppBuilds({
    eventName: 'pull_request',
    changedFiles: ['packages/tooling/webstir-frontend/src/cli.ts'],
  });

  assert.deepEqual(result, {
    buildHub: true,
    buildPortal: false,
    testModuleContract: false,
    testReleaseTools: false,
    testTestingContract: false,
  });
});

test('PRs touching shared dependency manifests build both apps', () => {
  const result = resolveCiAppBuilds({
    eventName: 'pull_request',
    changedFiles: ['bun.lock'],
  });

  assert.deepEqual(result, {
    buildHub: true,
    buildPortal: true,
    testModuleContract: true,
    testReleaseTools: true,
    testTestingContract: true,
  });
});

test('PRs with unrelated changes skip both app builds', () => {
  const result = resolveCiAppBuilds({
    eventName: 'pull_request',
    changedFiles: ['plans/core-hardening-plan.md'],
  });

  assert.deepEqual(result, {
    buildHub: false,
    buildPortal: false,
    testModuleContract: false,
    testReleaseTools: false,
    testTestingContract: false,
  });
});

test('PRs touching release tooling inputs run only release tools', () => {
  const result = resolveCiAppBuilds({
    eventName: 'pull_request',
    changedFiles: ['tools/resolve-release-package.mjs'],
  });

  assert.deepEqual(result, {
    buildHub: false,
    buildPortal: false,
    testModuleContract: false,
    testReleaseTools: true,
    testTestingContract: false,
  });
});

test('PRs touching the module contract run its contract gate without forcing release tools', () => {
  const result = resolveCiAppBuilds({
    eventName: 'pull_request',
    changedFiles: ['packages/contracts/module-contract/src/index.ts'],
  });

  assert.deepEqual(result, {
    buildHub: true,
    buildPortal: false,
    testModuleContract: true,
    testReleaseTools: false,
    testTestingContract: false,
  });
});

test('PRs touching the testing contract run only its contract gate', () => {
  const result = resolveCiAppBuilds({
    eventName: 'pull_request',
    changedFiles: ['packages/contracts/testing-contract/src/index.ts'],
  });

  assert.deepEqual(result, {
    buildHub: false,
    buildPortal: false,
    testModuleContract: false,
    testReleaseTools: false,
    testTestingContract: true,
  });
});

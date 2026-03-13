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
  });
});

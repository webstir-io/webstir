import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const portalContentRoot = 'apps/portal/src/frontend/content';

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('docs describe one supported Bun deployment contract', () => {
  const rootReadme = read('README.md');
  const solutionDoc = read(`${portalContentRoot}/explanations/solution.md`);
  const dockerDoc = read(`${portalContentRoot}/how-to/docker.md`);
  const publishDoc = read(`${portalContentRoot}/how-to/publish.md`);
  const workflowsDoc = read(`${portalContentRoot}/reference/workflows.md`);
  const backendReadme = read('packages/tooling/webstir-backend/README.md');
  const dockerReadme = read('orchestrators/bun/resources/deployment/docker/README.md');

  assert.match(rootReadme, /Supported Bun deployment contract/);
  assert.match(solutionDoc, /Supported Bun deployment contract:/);

  assert.match(dockerDoc, /supported deployment contract today/i);
  assert.match(dockerDoc, /single public port/i);
  assert.match(dockerDoc, /`GET \/healthz`/);
  assert.match(dockerDoc, /`GET \/readyz`/);
  assert.match(dockerDoc, /`GET \/metrics`/);

  assert.match(publishDoc, /supported Bun Docker deployment contract/i);
  assert.match(workflowsDoc, /supported Bun Docker deployment helper/i);

  assert.match(backendReadme, /supported Bun deploy runner/i);
  assert.match(backendReadme, /webstir-backend-deploy/);

  assert.match(dockerReadme, /Canonical Bun deployment contract/);
  assert.match(dockerReadme, /single public port/i);
});

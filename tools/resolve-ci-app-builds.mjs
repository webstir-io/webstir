import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PR_EVENT = 'pull_request';
const sharedAppBuildInputs = new Set(['bun.lock', 'package.json']);

export function resolveCiAppBuilds({ eventName, changedFiles }) {
  if (eventName !== PR_EVENT) {
    return {
      buildHub: true,
      buildPortal: true,
    };
  }

  const normalizedFiles = changedFiles
    .map((file) => file.trim())
    .filter(Boolean);

  return {
    buildHub: normalizedFiles.some((file) => shouldBuildHub(file)),
    buildPortal: normalizedFiles.some((file) => shouldBuildPortal(file)),
  };
}

function shouldBuildHub(file) {
  return sharedAppBuildInputs.has(file)
    || file.startsWith('apps/hub/')
    || file.startsWith('packages/tooling/webstir-frontend/')
    || file.startsWith('packages/contracts/module-contract/');
}

function shouldBuildPortal(file) {
  return sharedAppBuildInputs.has(file)
    || file.startsWith('apps/portal/');
}

function parseArgs(argv) {
  const changedFiles = [];
  let eventName;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--event') {
      eventName = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--changed-file') {
      changedFiles.push(argv[index + 1] ?? '');
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!eventName) {
    throw new Error('Missing required --event argument.');
  }

  return { eventName, changedFiles };
}

function isCliInvocation() {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }
  return path.resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isCliInvocation()) {
  const result = resolveCiAppBuilds(parseArgs(process.argv.slice(2)));
  console.log(`build_hub=${String(result.buildHub)}`);
  console.log(`build_portal=${String(result.buildPortal)}`);
}

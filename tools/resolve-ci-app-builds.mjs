import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PR_EVENT = 'pull_request';
const sharedAppBuildInputs = new Set(['bun.lock', 'package.json']);
const releaseToolInputs = [
  'tools/',
  'packages/contracts/module-contract/package.json',
  'packages/contracts/testing-contract/package.json',
  'packages/tooling/webstir-backend/package.json',
  'packages/tooling/webstir-frontend/package.json',
  'packages/tooling/webstir-testing/package.json',
  'orchestrators/bun/package.json',
];

export function resolveCiAppBuilds({ eventName, changedFiles }) {
  if (eventName !== PR_EVENT) {
    return {
      buildHub: true,
      buildPortal: true,
      testModuleContract: true,
      testReleaseTools: true,
      testTestingContract: true,
    };
  }

  const normalizedFiles = changedFiles
    .map((file) => file.trim())
    .filter(Boolean);

  return {
    buildHub: normalizedFiles.some((file) => shouldBuildHub(file)),
    buildPortal: normalizedFiles.some((file) => shouldBuildPortal(file)),
    testModuleContract: normalizedFiles.some((file) => shouldTestModuleContract(file)),
    testReleaseTools: normalizedFiles.some((file) => shouldTestReleaseTools(file)),
    testTestingContract: normalizedFiles.some((file) => shouldTestTestingContract(file)),
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

function shouldTestModuleContract(file) {
  return sharedAppBuildInputs.has(file)
    || file.startsWith('packages/contracts/module-contract/');
}

function shouldTestReleaseTools(file) {
  return sharedAppBuildInputs.has(file)
    || releaseToolInputs.some((candidate) => file === candidate || file.startsWith(candidate));
}

function shouldTestTestingContract(file) {
  return sharedAppBuildInputs.has(file)
    || file.startsWith('packages/contracts/testing-contract/');
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
  console.log(`test_module_contract=${String(result.testModuleContract)}`);
  console.log(`test_release_tools=${String(result.testReleaseTools)}`);
  console.log(`test_testing_contract=${String(result.testTestingContract)}`);
}

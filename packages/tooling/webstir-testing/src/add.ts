import path from 'node:path';
import { access, constants, mkdir, writeFile } from 'node:fs/promises';

export interface AddTestOptions {
  readonly workspaceRoot: string;
  readonly name: string;
}

export interface AddTestResult {
  readonly normalizedName: string;
  readonly created: boolean;
  readonly relativePath: string;
}

export async function runAddTest(options: AddTestOptions): Promise<AddTestResult> {
  const normalizedName = normalizeName(options.name);
  const srcRoot = path.join(options.workspaceRoot, 'src');
  const hasSlash = normalizedName.includes('/');

  let targetDirectory: string;
  let fileName: string;

  if (hasSlash) {
    const parent = path.posix.dirname(normalizedName);
    const leaf = path.posix.basename(normalizedName);
    targetDirectory = path.join(srcRoot, parent, 'tests');
    fileName = `${leaf}.test.ts`;
  } else {
    targetDirectory = path.join(srcRoot, 'tests');
    fileName = `${normalizedName}.test.ts`;
  }

  await mkdir(targetDirectory, { recursive: true });
  const targetFile = path.join(targetDirectory, fileName);
  const relativePath = path.relative(options.workspaceRoot, targetFile);

  if (await pathExists(targetFile)) {
    return {
      normalizedName,
      created: false,
      relativePath,
    };
  }

  await writeFile(targetFile, SAMPLE_TEST_TEMPLATE, 'utf8');

  return {
    normalizedName,
    created: true,
    relativePath,
  };
}

function normalizeName(raw: string): string {
  const trimmed = raw.trim().replace(/\\/g, '/');
  return trimmed.replace(/(\.test\.ts)$/i, '');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const SAMPLE_TEST_TEMPLATE = `import { test, assert } from '@webstir-io/webstir-testing';

test('sample passes', () => {
  assert.isTrue(true);
});
`;

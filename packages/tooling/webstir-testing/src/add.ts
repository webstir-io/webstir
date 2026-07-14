import path from 'node:path';
import { lstat, mkdir, writeFile } from 'node:fs/promises';

export interface AddTestOptions {
  readonly workspaceRoot: string;
  readonly name: string;
}

export interface AddTestResult {
  readonly normalizedName: string;
  readonly created: boolean;
  readonly relativePath: string;
}

export interface AddTestTarget {
  readonly normalizedName: string;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export async function runAddTest(options: AddTestOptions): Promise<AddTestResult> {
  const target = resolveAddTestTarget(options.workspaceRoot, options.name);
  await assertNoExistingSymlinkComponents(
    options.workspaceRoot,
    target.absolutePath,
    'regular-file',
  );

  const targetDirectory = path.dirname(target.absolutePath);
  await mkdir(targetDirectory, { recursive: true });
  await assertNoExistingSymlinkComponents(
    options.workspaceRoot,
    target.absolutePath,
    'regular-file',
  );

  if (await regularFileExists(target.absolutePath)) {
    return {
      normalizedName: target.normalizedName,
      created: false,
      relativePath: target.relativePath,
    };
  }

  try {
    await writeFile(target.absolutePath, SAMPLE_TEST_TEMPLATE, {
      encoding: 'utf8',
      flag: 'wx',
    });
  } catch (error) {
    if (!isAlreadyExistsError(error)) {
      throw error;
    }

    await assertNoExistingSymlinkComponents(
      options.workspaceRoot,
      target.absolutePath,
      'regular-file',
    );
    if (!(await regularFileExists(target.absolutePath))) {
      throw error;
    }
    return {
      normalizedName: target.normalizedName,
      created: false,
      relativePath: target.relativePath,
    };
  }

  return {
    normalizedName: target.normalizedName,
    created: true,
    relativePath: target.relativePath,
  };
}

export function resolveAddTestTarget(workspaceRoot: string, rawName: string): AddTestTarget {
  const normalizedName = normalizeName(rawName);
  const segments = normalizedName.split('/');
  const leaf = segments.at(-1);
  if (!leaf) {
    throw invalidNameError('a file name is required');
  }

  const relativePath =
    segments.length === 1
      ? path.join('src', 'tests', `${leaf}.test.ts`)
      : path.join('src', ...segments.slice(0, -1), 'tests', `${leaf}.test.ts`);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const sourceRoot = path.join(resolvedWorkspaceRoot, 'src');
  const absolutePath = path.resolve(resolvedWorkspaceRoot, relativePath);

  if (!isPathWithin(sourceRoot, absolutePath)) {
    throw invalidNameError('the generated test must stay inside the workspace src directory');
  }

  return {
    normalizedName,
    relativePath,
    absolutePath,
  };
}

async function regularFileExists(targetPath: string): Promise<boolean> {
  try {
    const stats = await lstat(targetPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Test scaffold target is not a regular file: ${targetPath}`);
    }
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
}

async function assertNoExistingSymlinkComponents(
  workspaceRoot: string,
  targetPath: string,
  finalTargetType: 'any' | 'regular-file' = 'any',
): Promise<void> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const relativeTarget = path.relative(resolvedWorkspaceRoot, targetPath);
  const segments = relativeTarget.split(path.sep);
  let currentPath = resolvedWorkspaceRoot;

  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    try {
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to scaffold a test through symbolic link: ${path.relative(resolvedWorkspaceRoot, currentPath)}`,
        );
      }
      const isFinalTarget = index === segments.length - 1;
      if (isFinalTarget && finalTargetType === 'regular-file' && !stats.isFile()) {
        throw new Error(`Test scaffold target is not a regular file: ${currentPath}`);
      }
      if (!isFinalTarget && !stats.isDirectory()) {
        throw new Error(`Test scaffold path component is not a directory: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
  }
}

function normalizeName(raw: string): string {
  if (containsAsciiControlCharacter(raw)) {
    throw invalidNameError('ASCII control characters are not allowed');
  }

  const normalized = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/(\.test\.ts)$/i, '');
  if (!normalized) {
    throw invalidNameError('a name or path is required');
  }
  if (normalized.startsWith('/')) {
    throw invalidNameError('absolute paths are not allowed');
  }
  if (/^[A-Za-z]:/.test(normalized)) {
    throw invalidNameError('Windows drive paths are not allowed');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalidNameError('path segments must be non-empty and cannot be "." or ".."');
  }
  for (const segment of segments) {
    assertPortableFilenameSegment(segment);
  }

  return normalized;
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function assertPortableFilenameSegment(segment: string): void {
  if (/[<>:"|?*]/.test(segment)) {
    throw invalidNameError('path segments cannot contain <, >, :, ", |, ?, or *');
  }
  if (/[. ]$/.test(segment)) {
    throw invalidNameError('path segments cannot end with a dot or space');
  }

  const deviceBasename = segment.split('.', 1)[0]?.trimEnd() ?? '';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i.test(deviceBasename)) {
    throw invalidNameError('Windows device basenames are not allowed');
  }
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

function invalidNameError(reason: string): Error {
  return new Error(`Invalid test name or path: ${reason}.`);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

const SAMPLE_TEST_TEMPLATE = `import { test, assert } from '@webstir-io/webstir-testing';

test('sample passes', () => {
  assert.isTrue(true);
});
`;

import path from 'node:path';
import { lstat } from 'node:fs/promises';

export interface ScaffoldAssetDescriptor {
  readonly sourcePath: string;
  readonly targetPath: string;
}

export interface PreflightedScaffoldAsset<T extends ScaffoldAssetDescriptor> {
  readonly asset: T;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly relativeTargetPath: string;
}

export function normalizeScaffoldSegment(rawValue: string, subject: string): string {
  const value = rawValue.trim();
  if (
    containsAsciiControlCharacter(rawValue) ||
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    !isPortableFilenameSegment(value)
  ) {
    const label = `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`;
    throw new Error(
      `Invalid ${subject} name. ${label} name must be a non-empty single path segment that is portable and contains no slashes, dot segments, reserved names or characters, or control bytes.`,
    );
  }

  return value;
}

const WINDOWS_RESERVED_BASENAME_PATTERN =
  /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i;

function isPortableFilenameSegment(value: string): boolean {
  const basename = value.split('.', 1)[0]?.trimEnd() ?? '';
  return (
    !containsAsciiControlCharacter(value) &&
    !/[<>:"|?*]/.test(value) &&
    !/[. ]$/.test(value) &&
    !WINDOWS_RESERVED_BASENAME_PATTERN.test(basename)
  );
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

export async function assertNoExistingSymlinkComponents(
  workspaceRoot: string,
  targetPath: string,
  operation: string,
  finalTargetType: 'any' | 'regular-file' = 'any',
): Promise<void> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedTargetPath = path.resolve(targetPath);

  if (!isPathWithin(resolvedWorkspaceRoot, resolvedTargetPath)) {
    throw new Error(`Refusing to ${operation} outside the workspace.`);
  }

  const relativeTarget = path.relative(resolvedWorkspaceRoot, resolvedTargetPath);
  let currentPath = resolvedWorkspaceRoot;

  const segments = relativeTarget.split(path.sep);
  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    try {
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) {
        throw new Error(
          `Refusing to ${operation} through symbolic link: ${path.relative(resolvedWorkspaceRoot, currentPath)}`,
        );
      }
      const isFinalTarget = index === segments.length - 1;
      if (isFinalTarget && finalTargetType === 'regular-file' && !stats.isFile()) {
        throw new Error(
          `Refusing to ${operation}; path is not a regular file: ${path.relative(resolvedWorkspaceRoot, currentPath)}`,
        );
      }
      if (isFinalTarget && finalTargetType === 'regular-file' && stats.nlink > 1) {
        throw new Error(
          `Refusing to ${operation}; path has multiple hard links: ${path.relative(resolvedWorkspaceRoot, currentPath)}`,
        );
      }
      if (!isFinalTarget && !stats.isDirectory()) {
        throw new Error(
          `Refusing to ${operation}; path component is not a directory: ${path.relative(resolvedWorkspaceRoot, currentPath)}`,
        );
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
  }
}

export async function preflightScaffoldAssets<T extends ScaffoldAssetDescriptor>(
  workspaceRoot: string,
  assets: readonly T[],
  operation: string,
): Promise<readonly PreflightedScaffoldAsset<T>[]> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const seenTargets = new Map<string, string>();
  const prepared = assets.map((asset) => {
    if (typeof asset.sourcePath !== 'string' || asset.sourcePath.length === 0) {
      throw new Error('Scaffold asset source path must be a non-empty string.');
    }
    if (typeof asset.targetPath !== 'string') {
      throw new Error('Scaffold asset target path must be a string.');
    }

    const relativeTargetPath = normalizeScaffoldAssetTargetPath(asset.targetPath);
    const duplicateKey = relativeTargetPath.normalize('NFC').toLowerCase();
    if (seenTargets.has(duplicateKey)) {
      throw new Error(`Duplicate scaffold asset target path: ${relativeTargetPath}`);
    }
    for (const [seenKey, seenPath] of seenTargets) {
      if (duplicateKey.startsWith(`${seenKey}/`) || seenKey.startsWith(`${duplicateKey}/`)) {
        throw new Error(
          `Conflicting scaffold asset target paths: ${seenPath} and ${relativeTargetPath}`,
        );
      }
    }
    seenTargets.set(duplicateKey, relativeTargetPath);

    const targetPath = path.resolve(resolvedWorkspaceRoot, ...relativeTargetPath.split('/'));
    if (!isPathWithin(resolvedWorkspaceRoot, targetPath)) {
      throw new Error(`Refusing to ${operation} outside the workspace.`);
    }

    return {
      asset,
      sourcePath: path.resolve(asset.sourcePath),
      targetPath,
      relativeTargetPath,
    };
  });

  for (const asset of prepared) {
    await assertRegularScaffoldAssetSource(asset.sourcePath);
    await assertNoExistingSymlinkComponents(
      resolvedWorkspaceRoot,
      asset.targetPath,
      operation,
      'regular-file',
    );
  }

  return prepared;
}

function normalizeScaffoldAssetTargetPath(value: string): string {
  if (containsAsciiControlCharacter(value)) {
    throw invalidScaffoldAssetTargetError('ASCII control characters are not allowed');
  }

  const normalized = value.replaceAll('\\', '/');
  if (!normalized) {
    throw invalidScaffoldAssetTargetError('a relative path is required');
  }
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw invalidScaffoldAssetTargetError('absolute paths are not allowed');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalidScaffoldAssetTargetError(
      'path segments must be non-empty and cannot be "." or ".."',
    );
  }
  if (segments.some((segment) => !isPortableFilenameSegment(segment))) {
    throw invalidScaffoldAssetTargetError('every path segment must be a portable filename');
  }

  return segments.join('/');
}

async function assertRegularScaffoldAssetSource(sourcePath: string): Promise<void> {
  try {
    const stats = await lstat(sourcePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Scaffold asset source is not a regular file: ${JSON.stringify(sourcePath)}`);
    }
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`Scaffold asset source not found: ${JSON.stringify(sourcePath)}`, {
        cause: error,
      });
    }
    throw error;
  }
}

function invalidScaffoldAssetTargetError(reason: string): Error {
  return new Error(`Invalid scaffold asset target path: ${reason}.`);
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

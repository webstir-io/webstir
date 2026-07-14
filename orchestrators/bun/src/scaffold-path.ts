import path from 'node:path';
import { lstat } from 'node:fs/promises';

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

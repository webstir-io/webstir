import path from 'node:path';

export interface PublishedAddTestTarget {
  readonly normalizedName: string;
  readonly relativePath: string;
  readonly absolutePath: string;
}

export function resolvePublishedAddTestTarget(
  workspaceRoot: string,
  rawName: string,
): PublishedAddTestTarget {
  const normalizedName = normalizePublishedAddTestName(rawName);
  const segments = normalizedName.split('/');
  const leaf = segments.at(-1);
  if (!leaf) {
    throw invalidPublishedAddTestNameError('a file name is required');
  }

  const relativePath =
    segments.length === 1
      ? path.join('src', 'tests', `${leaf}.test.ts`)
      : path.join('src', ...segments.slice(0, -1), 'tests', `${leaf}.test.ts`);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const sourceRoot = path.join(resolvedWorkspaceRoot, 'src');
  const absolutePath = path.resolve(resolvedWorkspaceRoot, relativePath);

  if (!isPathWithin(sourceRoot, absolutePath)) {
    throw invalidPublishedAddTestNameError(
      'the generated test must stay inside the workspace src directory',
    );
  }

  return {
    normalizedName,
    relativePath,
    absolutePath,
  };
}

function normalizePublishedAddTestName(raw: string): string {
  if (containsAsciiControlCharacter(raw)) {
    throw invalidPublishedAddTestNameError('ASCII control characters are not allowed');
  }

  const normalized = raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/(\.test\.ts)$/i, '');
  if (!normalized) {
    throw invalidPublishedAddTestNameError('a name or path is required');
  }
  if (normalized.startsWith('/')) {
    throw invalidPublishedAddTestNameError('absolute paths are not allowed');
  }
  if (/^[A-Za-z]:/.test(normalized)) {
    throw invalidPublishedAddTestNameError('Windows drive paths are not allowed');
  }

  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalidPublishedAddTestNameError(
      'path segments must be non-empty and cannot be "." or ".."',
    );
  }
  for (const segment of segments) {
    assertPortablePublishedFilenameSegment(segment);
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

function assertPortablePublishedFilenameSegment(segment: string): void {
  if (/[<>:"|?*]/.test(segment)) {
    throw invalidPublishedAddTestNameError('path segments cannot contain <, >, :, ", |, ?, or *');
  }
  if (/[. ]$/.test(segment)) {
    throw invalidPublishedAddTestNameError('path segments cannot end with a dot or space');
  }

  const deviceBasename = segment.split('.', 1)[0]?.trimEnd() ?? '';
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)$/i.test(deviceBasename)) {
    throw invalidPublishedAddTestNameError('Windows device basenames are not allowed');
  }
}

function invalidPublishedAddTestNameError(reason: string): Error {
  return new Error(`Invalid test name or path: ${reason}.`);
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

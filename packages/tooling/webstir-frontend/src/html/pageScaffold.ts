import path from 'node:path';
import { lstat, mkdir } from 'node:fs/promises';
import { EXTENSIONS, FILES, FOLDERS } from '../core/constants.js';
import { resolveManifestPath } from '../config/paths.js';
import { writeFile } from '../utils/fs.js';

export interface PageScaffoldOptions {
  readonly workspaceRoot: string;
  readonly pageName: string;
  readonly mode?: 'standard' | 'ssg';
  readonly paths: {
    readonly pages: string;
    readonly app: string;
  };
}

export interface PageScaffoldPreflightOptions {
  readonly workspaceRoot: string;
  readonly pageName: string;
  readonly pagesRoot?: string;
}

export async function createPageScaffold(options: PageScaffoldOptions): Promise<void> {
  const { pageName, workspaceRoot, pagesRoot } = await preflightPageScaffold({
    workspaceRoot: options.workspaceRoot,
    pageName: options.pageName,
    pagesRoot: options.paths.pages,
  });
  const pageDir = path.join(pagesRoot, pageName);
  await ensureSafeDirectoryPath(workspaceRoot, pagesRoot);
  await createPageDirectory(pageDir, pageName, workspaceRoot);

  const mode = options.mode ?? 'standard';
  const writes: Promise<void>[] = [
    writeFile(
      path.join(pageDir, `${FILES.index}${EXTENSIONS.html}`),
      buildHtmlTemplate(pageName, mode),
    ),
    writeFile(path.join(pageDir, `${FILES.index}${EXTENSIONS.css}`), buildCssTemplate(pageName)),
  ];

  if (mode === 'standard') {
    writes.push(
      writeFile(path.join(pageDir, `${FILES.index}${EXTENSIONS.ts}`), buildScriptTemplate()),
    );
  }

  await Promise.all(writes);
}

export function normalizePageName(rawName: string): string {
  const pageName = rawName.trim();
  if (
    containsAsciiControlCharacter(rawName) ||
    !pageName ||
    pageName === '.' ||
    pageName === '..' ||
    pageName.includes('/') ||
    pageName.includes('\\') ||
    pageName.includes('\0') ||
    path.posix.isAbsolute(pageName) ||
    path.win32.isAbsolute(pageName) ||
    !isPortableFilenameSegment(pageName)
  ) {
    throw new Error(
      'Page name must be a non-empty single path segment that is portable and contains no slashes, dot segments, reserved names or characters, or control bytes.',
    );
  }

  return pageName;
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

export async function preflightPageScaffold(options: PageScaffoldPreflightOptions): Promise<{
  readonly pageName: string;
  readonly workspaceRoot: string;
  readonly pagesRoot: string;
}> {
  const pageName = normalizePageName(options.pageName);
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const pagesRoot = path.resolve(
    options.pagesRoot ?? path.join(workspaceRoot, FOLDERS.src, FOLDERS.frontend, FOLDERS.pages),
  );
  const pageDir = path.join(pagesRoot, pageName);
  const manifestPath = resolveManifestPath(workspaceRoot);
  const packageJsonPath = path.join(workspaceRoot, FILES.packageJson);
  const frontendConfigPath = path.join(
    workspaceRoot,
    FOLDERS.src,
    FOLDERS.frontend,
    'frontend.config.json',
  );

  for (const targetPath of [pageDir, manifestPath, packageJsonPath, frontendConfigPath]) {
    assertPathWithinWorkspace(workspaceRoot, targetPath);
  }

  await assertExistingPathComponentsSafe(workspaceRoot, pageDir, 'directory');
  await assertPageDoesNotExist(pageDir, pageName);
  await assertExistingPathComponentsSafe(workspaceRoot, manifestPath, 'regular-file');
  await assertExistingPathComponentsSafe(workspaceRoot, packageJsonPath, 'regular-file');
  await assertExistingPathComponentsSafe(workspaceRoot, frontendConfigPath, 'regular-file');
  return { pageName, workspaceRoot, pagesRoot };
}

async function assertPageDoesNotExist(pageDir: string, pageName: string): Promise<void> {
  try {
    await lstat(pageDir);
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return;
    }
    throw error;
  }

  throw new Error(`Page '${pageName}' already exists.`);
}

function assertPathWithinWorkspace(workspaceRoot: string, targetPath: string): void {
  const relativePath = path.relative(workspaceRoot, targetPath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to scaffold a page outside the workspace: ${targetPath}`);
  }
}

async function assertExistingPathComponentsSafe(
  workspaceRoot: string,
  targetPath: string,
  finalTargetType: 'directory' | 'regular-file',
): Promise<void> {
  const relativePath = path.relative(workspaceRoot, targetPath);
  const segments = relativePath.split(path.sep);
  let currentPath = workspaceRoot;

  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    try {
      const info = await lstat(currentPath);
      if (info.isSymbolicLink()) {
        throw new Error(
          `Refusing to scaffold a page through symbolic link: ${toWorkspaceRelative(workspaceRoot, currentPath)}`,
        );
      }
      if (index === segments.length - 1 && finalTargetType === 'regular-file') {
        if (!info.isFile()) {
          throw new Error(
            `Page scaffold metadata path is not a regular file: ${toWorkspaceRelative(workspaceRoot, currentPath)}`,
          );
        }
        continue;
      }
      if (!info.isDirectory()) {
        throw new Error(
          `Page scaffold path is not a directory: ${toWorkspaceRelative(workspaceRoot, currentPath)}`,
        );
      }
    } catch (error) {
      if (!isErrnoException(error, 'ENOENT')) {
        throw error;
      }
    }
  }
}

async function ensureSafeDirectoryPath(
  workspaceRoot: string,
  targetDirectory: string,
): Promise<void> {
  assertPathWithinWorkspace(workspaceRoot, targetDirectory);
  const relativePath = path.relative(workspaceRoot, targetDirectory);
  let currentPath = workspaceRoot;

  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    await ensureDirectoryComponent(workspaceRoot, currentPath);
  }
}

async function ensureDirectoryComponent(
  workspaceRoot: string,
  directoryPath: string,
): Promise<void> {
  try {
    const info = await lstat(directoryPath);
    if (info.isSymbolicLink()) {
      throw new Error(
        `Refusing to scaffold a page through symbolic link: ${toWorkspaceRelative(workspaceRoot, directoryPath)}`,
      );
    }
    if (!info.isDirectory()) {
      throw new Error(
        `Page scaffold path is not a directory: ${toWorkspaceRelative(workspaceRoot, directoryPath)}`,
      );
    }
    return;
  } catch (error) {
    if (!isErrnoException(error, 'ENOENT')) {
      throw error;
    }
  }

  try {
    await mkdir(directoryPath);
  } catch (error) {
    if (!isErrnoException(error, 'EEXIST')) {
      throw error;
    }
    await ensureDirectoryComponent(workspaceRoot, directoryPath);
  }
}

async function createPageDirectory(
  pageDir: string,
  pageName: string,
  workspaceRoot: string,
): Promise<void> {
  try {
    await mkdir(pageDir);
  } catch (error) {
    if (!isErrnoException(error, 'EEXIST')) {
      throw error;
    }

    const info = await lstat(pageDir);
    if (info.isSymbolicLink()) {
      throw new Error(
        `Refusing to scaffold a page through symbolic link: ${toWorkspaceRelative(workspaceRoot, pageDir)}`,
      );
    }
    throw new Error(`Page '${pageName}' already exists.`);
  }
}

function isErrnoException(error: unknown, code: string): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function toWorkspaceRelative(workspaceRoot: string, targetPath: string): string {
  return path.relative(workspaceRoot, targetPath).replaceAll(path.sep, '/');
}

function buildHtmlTemplate(pageName: string, mode: 'standard' | 'ssg'): string {
  const displayName = escapeHtmlText(pageName);
  const script =
    mode === 'standard'
      ? `    <script type="module" src="${FILES.index}${EXTENSIONS.js}" async></script>`
      : `    <!-- Add ${FILES.index}${EXTENSIONS.ts} to enable JS on this page. -->`;

  return `<head>
    <meta charset="utf-8">
    <title>${displayName}</title>
    <link rel="stylesheet" href="${FILES.index}${EXTENSIONS.css}">
</head>
<body>
    <main>
        <h1>${displayName}</h1>
        <p>Content for the ${displayName} page.</p>
    </main>
${script}
</body>
`;
}

function buildCssTemplate(pageName: string): string {
  return `/* ${pageName} Page Styles */
@import "@app/app.css";

/* Add your page-specific styles here */
`;
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildScriptTemplate(): string {
  return `// Page entry point
import '../../app/app';

// Add page-specific logic here
`;
}

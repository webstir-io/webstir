import fs from 'node:fs';
import path from 'node:path';
import type { FrontendConfig, FrontendContentConfig, FrontendFeatureFlags } from '../types.js';
import { FOLDERS } from '../core/constants.js';
import { frontendFeatureFlagsSchema } from './schema.js';

export function buildConfig(workspaceRoot: string): FrontendConfig {
  const srcRoot = path.join(workspaceRoot, FOLDERS.src);
  const frontendRoot = path.join(srcRoot, FOLDERS.frontend);
  const buildRoot = path.join(workspaceRoot, FOLDERS.build);
  const distRoot = path.join(workspaceRoot, FOLDERS.dist);
  const rawConfig = loadFrontendConfig(frontendRoot);
  const contentConfig = resolveContentConfig(rawConfig);

  const buildFrontend = path.join(buildRoot, FOLDERS.frontend);
  const distFrontend = path.join(distRoot, FOLDERS.frontend);
  const srcContentRoot = resolveContentRoot(workspaceRoot, frontendRoot, rawConfig);
  const contentPath = contentConfig.basePath.slice(1, -1);

  return {
    version: 1,
    paths: {
      workspace: workspaceRoot,
      src: {
        root: srcRoot,
        frontend: frontendRoot,
        app: path.join(frontendRoot, FOLDERS.app),
        pages: path.join(frontendRoot, FOLDERS.pages),
        content: srcContentRoot,
        images: path.join(frontendRoot, FOLDERS.images),
        fonts: path.join(frontendRoot, FOLDERS.fonts),
        media: path.join(frontendRoot, FOLDERS.media),
      },
      build: {
        root: buildRoot,
        frontend: buildFrontend,
        app: path.join(buildFrontend, FOLDERS.app),
        pages: path.join(buildFrontend, FOLDERS.pages),
        content: path.join(buildFrontend, FOLDERS.pages, contentPath),
        images: path.join(buildFrontend, FOLDERS.images),
        fonts: path.join(buildFrontend, FOLDERS.fonts),
        media: path.join(buildFrontend, FOLDERS.media),
      },
      dist: {
        root: distRoot,
        frontend: distFrontend,
        app: path.join(distFrontend, FOLDERS.app),
        pages: path.join(distFrontend, FOLDERS.pages),
        content: path.join(distFrontend, FOLDERS.pages, contentPath),
        images: path.join(distFrontend, FOLDERS.images),
        fonts: path.join(distFrontend, FOLDERS.fonts),
        media: path.join(distFrontend, FOLDERS.media),
      },
    },
    features: loadFeatureFlags(frontendRoot, rawConfig),
    content: contentConfig,
  };
}

function loadFrontendConfig(frontendRoot: string): unknown {
  const configPath = path.join(frontendRoot, 'frontend.config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read frontend config from ${configPath}: ${message}`);
  }
}

function resolveContentRoot(
  workspaceRoot: string,
  frontendRoot: string,
  rawConfig: unknown,
): string {
  const defaultContentRoot = path.join(frontendRoot, 'content');
  try {
    const override = extractContentRoot(rawConfig);

    if (override === undefined) {
      return defaultContentRoot;
    }

    if (typeof override !== 'string') {
      throw new Error('Expected contentRoot to be a string when specified.');
    }

    const trimmed = override.trim();
    if (!trimmed) {
      return defaultContentRoot;
    }

    if (path.isAbsolute(trimmed)) {
      return trimmed;
    }

    return path.join(workspaceRoot, trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read frontend content root: ${message}`);
  }
}

function resolveContentConfig(rawConfig: unknown): FrontendContentConfig {
  const rawContent = extractContentConfig(rawConfig);
  const basePathValue =
    rawContent && typeof rawContent === 'object'
      ? (rawContent as Record<string, unknown>).basePath
      : undefined;
  const labelValue =
    rawContent && typeof rawContent === 'object'
      ? (rawContent as Record<string, unknown>).label
      : undefined;

  const basePath =
    typeof basePathValue === 'string' && basePathValue.trim()
      ? normalizeContentBasePath(basePathValue)
      : '/docs/';
  const pageName = resolveContentPageName(basePath);
  const label =
    typeof labelValue === 'string' && labelValue.trim()
      ? labelValue.trim()
      : pageName === 'docs'
        ? 'Docs'
        : toTitleCase(pageName.replace(/[-_]/g, ' '));

  return {
    basePath,
    label,
    navManifest: `${pageName}-nav.json`,
    pageName,
  };
}

function extractContentConfig(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const container = value as Record<string, unknown>;
  return container.content;
}

function normalizeContentBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) {
    throw new Error(`Expected frontend content.basePath to start with "/": ${value}`);
  }

  const withoutTrailingIndex = trimmed.replace(/\/index\.html$/i, '/');
  const normalized = withoutTrailingIndex.endsWith('/')
    ? withoutTrailingIndex
    : `${withoutTrailingIndex}/`;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length !== 1) {
    throw new Error(
      `Expected frontend content.basePath to be one path segment such as "/docs/" or "/company/": ${value}`,
    );
  }

  return `/${segments[0]}/`;
}

function resolveContentPageName(basePath: string): string {
  const [segment] = basePath.split('/').filter(Boolean);
  if (!segment) {
    throw new Error(`Expected frontend content.basePath to include a page segment: ${basePath}`);
  }
  return segment;
}

function extractContentRoot(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const container = value as Record<string, unknown>;

  if ('paths' in container && container.paths && typeof container.paths === 'object') {
    const pathsContainer = container.paths as Record<string, unknown>;
    if ('contentRoot' in pathsContainer) {
      return pathsContainer.contentRoot;
    }
  }

  if ('contentRoot' in container) {
    return container.contentRoot;
  }

  return undefined;
}

function loadFeatureFlags(frontendRoot: string, rawConfig: unknown): FrontendFeatureFlags {
  try {
    const overridesSource = extractOverrideSource(rawConfig);
    const overrides = frontendFeatureFlagsSchema.parse(overridesSource);
    return {
      htmlSecurity: overrides.htmlSecurity,
      externalResourceIntegrity: overrides.externalResourceIntegrity,
      imageOptimization: overrides.imageOptimization,
      precompression: overrides.precompression,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read frontend feature flags from ${frontendRoot}: ${message}`);
  }
}

function extractOverrideSource(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && 'features' in (value as Record<string, unknown>)) {
    const container = (value as Record<string, unknown>).features;
    if (container && typeof container === 'object') {
      return container as Record<string, unknown>;
    }
  }

  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

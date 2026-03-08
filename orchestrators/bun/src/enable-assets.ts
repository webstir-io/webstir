import path from 'node:path';

import { repoRoot } from './paths.ts';

const dotnetFeaturesRoot = path.join(repoRoot, 'orchestrators', 'dotnet', 'Engine', 'Resources', 'features');

export interface StaticFeatureAsset {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly executable?: boolean;
  readonly overwrite?: boolean;
}

export function getSpaAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(dotnetFeaturesRoot, 'router', 'router.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'router.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(dotnetFeaturesRoot, 'router', 'router-types.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'router-types.ts'),
      overwrite: true,
    },
  ];
}

export function getClientNavAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(dotnetFeaturesRoot, 'client_nav', 'client_nav.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'scripts', 'features', 'client-nav.ts'),
      overwrite: true,
    },
  ];
}

export function getSearchAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(dotnetFeaturesRoot, 'search', 'search.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'scripts', 'features', 'search.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(dotnetFeaturesRoot, 'search', 'search.css'),
      targetPath: path.join('src', 'frontend', 'app', 'styles', 'features', 'search.css'),
      overwrite: true,
    },
  ];
}

export function getContentNavAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(dotnetFeaturesRoot, 'content_nav', 'content_nav.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'scripts', 'features', 'content-nav.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(dotnetFeaturesRoot, 'content_nav', 'content_nav.css'),
      targetPath: path.join('src', 'frontend', 'app', 'styles', 'features', 'content-nav.css'),
      overwrite: true,
    },
  ];
}

export const pageScriptTemplate = `// Client-side script for this page.
// Add your interactive behavior here. This runs after the static HTML renders.

console.info('[webstir] Page script loaded.');
`;

export function renderGithubPagesDeployScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/frontend"
REMOTE="\${GH_PAGES_REMOTE:-origin}"
BRANCH="\${GH_PAGES_BRANCH:-gh-pages}"
COMMIT_MESSAGE="\${GH_PAGES_COMMIT_MESSAGE:-Deploy}"
COMMIT_NAME="\${GH_PAGES_COMMIT_NAME:-github-actions[bot]}"
COMMIT_EMAIL="\${GH_PAGES_COMMIT_EMAIL:-github-actions[bot]@users.noreply.github.com}"

WORKTREE_DIR=""
cleanup() {
  if [[ -n "\${WORKTREE_DIR}" && -d "\${WORKTREE_DIR}" ]]; then
    git worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
    rm -rf "$WORKTREE_DIR"
  fi
}
trap cleanup EXIT

publish_site() {
  if [[ -n "\${WEBSTIR_PUBLISH_CMD:-}" ]]; then
    echo "[gh-pages] Running WEBSTIR_PUBLISH_CMD..."
    bash -lc "\${WEBSTIR_PUBLISH_CMD}"
    return
  fi

  echo "[gh-pages] Running Bun publish fallback..."
  bunx --bun webstir-frontend publish -w "$ROOT_DIR" -m ssg
}

echo "[gh-pages] Publishing static site..."
publish_site

if [[ ! -d "$DIST_DIR" ]]; then
  echo "[gh-pages] Expected dist at $DIST_DIR but it was not found." >&2
  exit 1
fi

git fetch "$REMOTE" "$BRANCH" >/dev/null 2>&1 || true

WORKTREE_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t webstir-gh-pages)"
if git show-ref --verify --quiet "refs/remotes/$REMOTE/$BRANCH"; then
  git worktree add "$WORKTREE_DIR" "$REMOTE/$BRANCH" >/dev/null
else
  git worktree add -b "$BRANCH" "$WORKTREE_DIR" >/dev/null
fi

rm -rf "$WORKTREE_DIR"/*
for entry in "$WORKTREE_DIR"/.*; do
  name="$(basename "$entry")"
  if [[ "$name" == "." || "$name" == ".." || "$name" == ".git" ]]; then
    continue
  fi
  rm -rf "$entry"
done
cp -R "$DIST_DIR"/. "$WORKTREE_DIR"/
touch "$WORKTREE_DIR/.nojekyll"

if [[ -z "$(git -C "$WORKTREE_DIR" config user.name || true)" ]]; then
  git -C "$WORKTREE_DIR" config user.name "$COMMIT_NAME"
fi

if [[ -z "$(git -C "$WORKTREE_DIR" config user.email || true)" ]]; then
  git -C "$WORKTREE_DIR" config user.email "$COMMIT_EMAIL"
fi

git -C "$WORKTREE_DIR" add -A
if git -C "$WORKTREE_DIR" diff --cached --quiet; then
  echo "[gh-pages] No changes to deploy."
  exit 0
fi

git -C "$WORKTREE_DIR" commit -m "$COMMIT_MESSAGE"
if [[ -n "\${GH_PAGES_NO_PUSH:-}" ]]; then
  echo "[gh-pages] Skipping push (GH_PAGES_NO_PUSH is set)."
  exit 0
fi

git -C "$WORKTREE_DIR" push "$REMOTE" HEAD:"$BRANCH"
echo "[gh-pages] Deployed to $REMOTE/$BRANCH"
`;
}

export function renderGithubPagesWorkflow(): string {
  return `name: Deploy GitHub Pages

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: gh-pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.5

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Deploy
        run: bun run deploy
`;
}

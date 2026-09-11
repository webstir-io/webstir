import path from 'node:path';

import { assetsRoot } from './paths.ts';

const featuresRoot = path.join(assetsRoot, 'features');

export interface StaticFeatureAsset {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly executable?: boolean;
  readonly overwrite?: boolean;
}

export function getSpaAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(featuresRoot, 'router', 'router.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'router.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(featuresRoot, 'router', 'router-types.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'router-types.ts'),
      overwrite: true,
    },
  ];
}

export function getClientNavAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(featuresRoot, 'client_nav', 'client_nav.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'scripts', 'features', 'client-nav.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(featuresRoot, 'client_nav', 'form_enhancement.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'scripts', 'features', 'form-enhancement.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(featuresRoot, 'client_nav', 'document_navigation.ts'),
      targetPath: path.join(
        'src',
        'frontend',
        'app',
        'scripts',
        'features',
        'document-navigation.ts',
      ),
      overwrite: true,
    },
  ];
}

export function getSearchAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(featuresRoot, 'search', 'search.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'scripts', 'features', 'search.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(featuresRoot, 'search', 'search.css'),
      targetPath: path.join('src', 'frontend', 'app', 'styles', 'features', 'search.css'),
      overwrite: true,
    },
  ];
}

export function getContentNavAssets(): readonly StaticFeatureAsset[] {
  return [
    {
      sourcePath: path.join(featuresRoot, 'content_nav', 'content_nav.ts'),
      targetPath: path.join('src', 'frontend', 'app', 'scripts', 'features', 'content-nav.ts'),
      overwrite: true,
    },
    {
      sourcePath: path.join(featuresRoot, 'content_nav', 'content_nav.css'),
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

  echo "[gh-pages] Running Bun build and publish fallback..."
  bunx --bun webstir-frontend build -w "$ROOT_DIR"
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
          bun-version: 1.3.11

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Deploy
        run: bun run deploy
`;
}

export function renderS3CloudFrontDeployScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist/frontend"
BUCKET="\${S3_BUCKET:?Set S3_BUCKET to the target bucket name.}"
BUCKET="\${BUCKET#s3://}"
DISTRIBUTION_ID="\${CLOUDFRONT_DISTRIBUTION_ID:-}"
RETENTION_DAYS="\${S3_BUNDLE_RETENTION_DAYS:-7}"
MANIFEST_PREFIX=".webstir-deploys"
IMMUTABLE_CACHE="public,max-age=31536000,immutable"
DOCUMENT_CACHE="public,max-age=0,must-revalidate"

publish_site() {
  if [[ -n "\${WEBSTIR_PUBLISH_CMD:-}" ]]; then
    echo "[s3-cloudfront] Running WEBSTIR_PUBLISH_CMD..."
    bash -lc "\${WEBSTIR_PUBLISH_CMD}"
    return
  fi

  echo "[s3-cloudfront] Running Bun build and publish fallback..."
  bunx --bun webstir-frontend build -w "$ROOT_DIR"
  bunx --bun webstir-frontend publish -w "$ROOT_DIR" -m ssg
}

echo "[s3-cloudfront] Publishing static site..."
publish_site

if [[ ! -f "$DIST_DIR/index.html" ]]; then
  echo "[s3-cloudfront] Expected $DIST_DIR/index.html after publish but it was not found." >&2
  exit 1
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "[s3-cloudfront] Missing AWS credentials. Configure an AWS profile locally or OIDC role assumption in CI." >&2
  exit 1
fi

# Fingerprinted bundles (app-<hash>.js, index-<hash>.css, ...) never change
# content, so they can be cached forever. Upload the new ones first, without
# deleting, so pages that are live during the deploy keep their bundles.
echo "[s3-cloudfront] Uploading fingerprinted assets..."
aws s3 sync "$DIST_DIR/" "s3://$BUCKET" \\
  --exclude "*" \\
  --include "*-????????.css" \\
  --include "*-????????.js" \\
  --cache-control "$IMMUTABLE_CACHE"

# Documents, metadata, and unversioned files: revalidate on every request.
# Precompressed variants stay local; CloudFront compresses at the edge.
echo "[s3-cloudfront] Uploading documents and static files..."
aws s3 sync "$DIST_DIR/" "s3://$BUCKET" \\
  --delete \\
  --exclude "*-????????.css" \\
  --exclude "*-????????.js" \\
  --exclude "*.br" \\
  --exclude "*.gz" \\
  --exclude ".DS_Store" \\
  --exclude "$MANIFEST_PREFIX/*" \\
  --cache-control "$DOCUMENT_CACHE"

aws s3api head-object --bucket "$BUCKET" --key "index.html" >/dev/null

# Record which bundles this publish references so cleanup can tell when a
# bundle was last served, rather than when it was uploaded.
manifest="$(mktemp)"
(cd "$DIST_DIR" && find . -type f \\( -name '*-????????.css' -o -name '*-????????.js' \\) | sed 's|^\\./||' | sort) > "$manifest"
aws s3 cp "$manifest" "s3://$BUCKET/$MANIFEST_PREFIX/$(date -u +%Y%m%dT%H%M%SZ).txt" --cache-control "private,no-store" >/dev/null
rm -f "$manifest"

if [[ -n "$DISTRIBUTION_ID" ]]; then
  echo "[s3-cloudfront] Invalidating CloudFront distribution $DISTRIBUTION_ID..."
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" >/dev/null
fi

echo "[s3-cloudfront] Deployed $DIST_DIR to s3://$BUCKET"

# Previous bundles stay in the bucket: edge caches and already-open pages can
# still reference them. A release is active from its publish until the next
# publish, so a bundle is removed only when no release that was active at any
# point inside the retention window referenced it. That keeps every manifest
# inside the window plus the newest one before the cutoff (the release that was
# live when the window began). The first deploy has no history and leaves
# everything in place.
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  cutoff="$(date -u -d "$RETENTION_DAYS days ago" +%Y%m%d 2>/dev/null || date -u -v-"$RETENTION_DAYS"d +%Y%m%d)"
  manifests="$(aws s3 ls "s3://$BUCKET/$MANIFEST_PREFIX/" | awk '{print $4}' | grep -E '^[0-9]{8}T[0-9]{6}Z\\.txt$' | sort || true)"
  if [[ "$(printf '%s\\n' "$manifests" | grep -c .)" -lt 2 ]]; then
    echo "[s3-cloudfront] No publish history yet; skipping bundle cleanup."
  else
    oldest_active="$(printf '%s\\n' "$manifests" | awk -v cutoff="$cutoff" 'substr($0, 1, 8) < cutoff { last = $0 } END { print last }')"
    referenced="$(mktemp)"
    for name in $manifests; do
      if [[ -n "$oldest_active" && "$name" < "$oldest_active" ]]; then
        aws s3 rm "s3://$BUCKET/$MANIFEST_PREFIX/$name" >/dev/null
      else
        aws s3 cp "s3://$BUCKET/$MANIFEST_PREFIX/$name" - >> "$referenced"
        printf '\\n' >> "$referenced"
      fi
    done
    echo "[s3-cloudfront] Removing bundles not part of any release active since $cutoff..."
    aws s3 ls "s3://$BUCKET" --recursive | while read -r _ _ _ key; do
      case "$key" in
        *-????????.css|*-????????.js) ;;
        *) continue ;;
      esac
      if grep -qxF "$key" "$referenced"; then
        continue
      fi
      aws s3 rm "s3://$BUCKET/$key" >/dev/null
      echo "[s3-cloudfront] Removed $key"
    done
    rm -f "$referenced"
  fi
fi
`;
}

export function renderS3CloudFrontFunction(): string {
  return `// CloudFront Function (viewer-request) for Webstir SSG output behind an S3 origin.
//
// The S3 REST origin only serves exact object keys: it does not map /about/ to
// about/index.html the way an S3 website endpoint does. Attach this function to
// the distribution's default behavior on the viewer-request event so directory
// URLs resolve. Runtime: cloudfront-js-2.0.
//
// Console: CloudFront -> Functions -> Create -> paste -> Publish -> associate.
// CDK: new cloudfront.Function(this, 'RewriteDirectoryIndex', {
//        runtime: cloudfront.FunctionRuntime.JS_2_0,
//        code: cloudfront.FunctionCode.fromFile({ filePath: 'utils/cloudfront-rewrite-directory-index.js' }),
//      }) with functionAssociations: [{ function, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }].
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}
`;
}

export function renderS3CloudFrontWorkflow(): string {
  return `name: Deploy to S3 and CloudFront

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

concurrency:
  group: s3-cloudfront
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.11

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ vars.AWS_ROLE_ARN }}
          aws-region: \${{ vars.AWS_REGION }}

      - name: Deploy
        env:
          S3_BUCKET: \${{ vars.S3_BUCKET }}
          CLOUDFRONT_DISTRIBUTION_ID: \${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}
        run: bash ./utils/deploy-s3-cloudfront.sh
`;
}

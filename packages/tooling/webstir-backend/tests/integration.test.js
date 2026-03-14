import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build as esbuild } from 'esbuild';

import { backendProvider } from '../dist/index.js';

async function createTempWorkspace(prefix = 'webstir-backend-workspace-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return dir;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function hydrateBackendScaffold(workspace) {
  const assets = await backendProvider.getScaffoldAssets();

  for (const asset of assets) {
    const normalized = asset.targetPath.replace(/\\/g, '/');
    if (!normalized.includes('src/backend/')) {
      continue;
    }

    const target = path.join(workspace, asset.targetPath);
    await copyFile(asset.sourcePath, target);
  }
}


function getLocalBinPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgRoot = path.resolve(here, '..');
  return path.join(pkgRoot, 'node_modules', '.bin');
}

function getPackageRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..');
}

async function linkWorkspaceNodeModules(workspace) {
  const packageRoot = getPackageRoot();
  const source = path.join(packageRoot, 'node_modules');
  const target = path.join(workspace, 'node_modules');
  await fs.mkdir(target, { recursive: true });

  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '@webstir-io') {
      continue;
    }
    await createSymlinkIfMissing(
      path.join(source, entry.name),
      path.join(target, entry.name),
      entry.isDirectory() ? 'dir' : 'file'
    );
  }

  const scopeSource = path.join(source, '@webstir-io');
  const scopeTarget = path.join(target, '@webstir-io');
  await fs.mkdir(scopeTarget, { recursive: true });
  const scopeEntries = await fs.readdir(scopeSource, { withFileTypes: true });
  for (const entry of scopeEntries) {
    await createSymlinkIfMissing(
      path.join(scopeSource, entry.name),
      path.join(scopeTarget, entry.name),
      entry.isDirectory() ? 'dir' : 'file'
    );
  }

  await createSymlinkIfMissing(packageRoot, path.join(scopeTarget, 'webstir-backend'), 'dir');
}

async function createSymlinkIfMissing(source, target, type) {
  try {
    await fs.symlink(source, target, type);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return;
    }
    throw error;
  }
}

async function getOpenPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate an open port.'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function canListenOnTcp() {
  return await new Promise((resolve) => {
    const server = net.createServer();
    const settle = (value) => {
      server.removeAllListeners();
      server.close(() => resolve(value));
    };
    server.once('error', (error) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EPERM') {
        resolve(false);
        return;
      }
      resolve(false);
    });
    server.listen(0, '127.0.0.1', () => settle(true));
  });
}

async function startBuiltServer(workspace, port, extraEnv = {}, options = {}) {
  const entryUrl = pathToFileURL(path.join(workspace, 'build', 'backend', 'index.js')).href;
  const child = spawn('node', ['--input-type=module', '--eval', `import(${JSON.stringify(entryUrl)}).then((mod) => mod.start())`], {
    cwd: options.cwd ?? workspace,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  try {
    await Promise.race([
      waitFor(async () => await canConnectToPort(port), 10000, 50),
      new Promise((_, reject) => {
        child.once('exit', (code, signal) => {
          reject(new Error(`Backend server exited before readiness (code=${code ?? 'null'} signal=${signal ?? 'null'}).`));
        });
      })
    ]);
  } catch (error) {
    child.kill('SIGTERM');
    await onceExit(child);
    throw new Error(`Backend server did not become ready.\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    async stop() {
      child.kill('SIGTERM');
      await onceExit(child);
    }
  };
}

async function buildRuntimeWorkspace(workspace, { moduleSource, useFastify = false, mode = 'publish' } = {}) {
  await hydrateBackendScaffold(workspace);
  await linkWorkspaceNodeModules(workspace);
  await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module' }, null, 2), 'utf8');
  await fs.writeFile(path.join(workspace, 'src', 'backend', 'module.ts'), moduleSource, 'utf8');

  if (useFastify) {
    await fs.writeFile(
      path.join(workspace, 'src', 'backend', 'index.ts'),
      "export { start } from './server/fastify.js';\n",
      'utf8'
    );
  }

  await backendProvider.build({
    workspaceRoot: workspace,
    env: {
      WEBSTIR_MODULE_MODE: mode,
      WEBSTIR_BACKEND_TYPECHECK: 'skip',
      PATH: `${getLocalBinPath()}${path.delimiter}${process.env.PATH ?? ''}`
    },
    incremental: false
  });
}

async function writeFrontendDocument(workspace, pageName, html) {
  const targetPath = path.join(workspace, 'build', 'frontend', 'pages', pageName, 'index.html');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, html, 'utf8');
}

async function writePublishedFrontendAliasDocument(workspace, pageName, html) {
  const targetPath =
    pageName === 'home'
      ? path.join(workspace, 'dist', 'frontend', 'index.html')
      : path.join(workspace, 'dist', 'frontend', pageName, 'index.html');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, html, 'utf8');
}

function createRequestHookRuntimeModuleSource() {
  return `const routes = [
  {
    definition: {
      name: 'hookRoute',
      method: 'GET',
      path: '/hooks/demo',
      requestHooks: [
        { id: 'after-response' },
        { id: 'short-circuit' },
        { id: 'annotate-auth' },
        { id: 'setup-request' }
      ]
    },
    handler: async (ctx) => {
      ctx.db.trace.push('handler');
      return {
        status: 200,
        body: {
          trace: [...ctx.db.trace],
          authSource: ctx.auth?.source ?? null,
          sessionId: ctx.session?.id ?? null
        }
      };
    }
  }
];

const requestHooks = [
  {
    id: 'setup-request',
    handler: async (ctx) => {
      ctx.db.trace = ['beforeAuth'];
      ctx.session = { id: 'session-from-hook' };
    }
  },
  {
    id: 'annotate-auth',
    handler: async (ctx) => {
      ctx.db.trace.push(\`beforeHandler:\${String(ctx.auth?.source ?? 'missing')}\`);
    }
  },
  {
    id: 'short-circuit',
    handler: async (ctx) => {
      ctx.db.trace.push('beforeHandler:short-check');
      if (ctx.query.short === '1') {
        return {
          status: 202,
          body: {
            trace: [...ctx.db.trace],
            authSource: ctx.auth?.source ?? null,
            sessionId: ctx.session?.id ?? null,
            shortCircuited: true
          }
        };
      }
      if (ctx.query.fail === '1') {
        throw new Error('request hook failed');
      }
    }
  },
  {
    id: 'after-response',
    handler: async (ctx, input) => ({
      ...input.result,
      headers: {
        ...(input.result?.headers ?? {}),
        'x-hook-after': '1'
      },
      body: {
        ...(input.result?.body ?? {}),
        trace: [...(input.result?.body?.trace ?? []), 'afterHandler'],
        authSource: input.result?.body?.authSource ?? ctx.auth?.source ?? null,
        sessionId: input.result?.body?.sessionId ?? ctx.session?.id ?? null
      }
    })
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime-hooks',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http', 'auth'],
    requestHooks: [
      { id: 'setup-request', phase: 'beforeAuth', order: 10 },
      { id: 'short-circuit', phase: 'beforeHandler', order: 20 },
      { id: 'annotate-auth', phase: 'beforeHandler', order: 10 },
      { id: 'after-response', phase: 'afterHandler', order: 10 }
    ],
    routes: routes.map((route) => route.definition)
  },
  routes,
  requestHooks
};
`;
}

function createAuthRuntimeModuleSource() {
  return `const routes = [
  {
    definition: {
      name: 'authWhoAmI',
      method: 'GET',
      path: '/auth/whoami'
    },
    handler: async (ctx) => {
      if (!ctx.auth) {
        return {
          status: 401,
          body: { error: 'unauthorized' }
        };
      }

      return {
        status: 200,
        body: {
          source: ctx.auth.source,
          userId: ctx.auth.userId ?? null,
          email: ctx.auth.email ?? null,
          scopes: ctx.auth.scopes,
          roles: ctx.auth.roles
        }
      };
    }
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime-auth',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http', 'auth'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
`;
}

function createBodyLimitRuntimeModuleSource() {
  return `const routes = [
  {
    definition: {
      name: 'echoPayload',
      method: 'POST',
      path: '/echo',
      interaction: 'mutation'
    },
    handler: async (ctx) => ({
      status: 200,
      body: {
        echoed: ctx.body
      }
    })
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime-body-limit',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
`;
}

function createSessionRuntimeModuleSource() {
  return `const routes = [
  {
    definition: {
      name: 'sessionLogin',
      method: 'POST',
      path: '/session/login',
      interaction: 'mutation',
      form: {
        contentType: 'application/x-www-form-urlencoded',
        session: { write: true },
        flash: {
          publish: [{ key: 'signed-in', level: 'success', when: 'success' }]
        }
      }
    },
    handler: async (ctx) => {
      const email = String(ctx.body?.email ?? 'guest@example.com');
      ctx.session = {
        userId: email,
        data: { email }
      };
      return {
        status: 303,
        redirect: { location: '/session/account' }
      };
    }
  },
  {
    definition: {
      name: 'sessionAccount',
      method: 'GET',
      path: '/session/account',
      interaction: 'navigation',
      session: { mode: 'optional' },
      flash: { consume: ['signed-in'] }
    },
    handler: async (ctx) => ({
      status: 200,
      body: \`<main data-user="\${String(ctx.session?.userId ?? 'guest')}" data-flash="\${ctx.flash.map((message) => \`\${message.key}:\${message.level}\`).join(',')}">\${String(ctx.session?.data?.email ?? 'guest')}</main>\`
    })
  },
  {
    definition: {
      name: 'sessionLogout',
      method: 'POST',
      path: '/session/logout',
      interaction: 'mutation',
      form: {
        contentType: 'application/x-www-form-urlencoded',
        session: { write: true }
      }
    },
    handler: async (ctx) => {
      ctx.session = null;
      return {
        status: 303,
        redirect: { location: '/session/account' }
      };
    }
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime-session',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
`;
}

function createFormWorkflowModuleSource() {
  return `import {
  groupFormIssuesByField,
  prepareFormState,
  processFormSubmission
} from './runtime/forms.js';

const accountSettingsPageDefinition = {
  name: 'accountSettingsPage',
  method: 'GET',
  path: '/account/settings',
  interaction: 'navigation',
  session: { mode: 'optional' },
  flash: { consume: ['settings-saved'] }
};

const updateAccountSettingsDefinition = {
  name: 'accountSettingsUpdate',
  method: 'POST',
  path: '/account/settings',
  interaction: 'mutation',
  form: {
    contentType: 'application/x-www-form-urlencoded',
    csrf: true,
    session: { write: true },
    flash: {
      publish: [{ key: 'settings-saved', level: 'success', when: 'success' }]
    }
  }
};

const routes = [
  {
    definition: accountSettingsPageDefinition,
    handler: async (ctx) => {
      const form = prepareFormState({
        session: ctx.session,
        formId: 'account-settings',
        route: updateAccountSettingsDefinition,
        now: ctx.now
      });
      ctx.session = form.session;
      const grouped = groupFormIssuesByField(form.issues);
      const email =
        (typeof form.values.email === 'string' ? form.values.email : undefined) ??
        ctx.session?.profile?.email ??
        'guest@example.com';

      return {
        status: 200,
        body: \`<main data-user="\${String(email)}" data-form-errors="\${grouped.form.join('|')}" data-field-errors="\${(grouped.fields.email ?? []).join('|')}" data-flash="\${ctx.flash.map((message) => \`\${message.key}:\${message.level}\`).join('|')}"><form method="post" action="/account/settings"><input type="hidden" name="_csrf" value="\${form.csrfToken ?? ''}" /><input name="email" value="\${String(email)}" /><button type="submit">Save</button></form></main>\`
      };
    }
  },
  {
    definition: updateAccountSettingsDefinition,
    handler: async (ctx) => {
      const submission = processFormSubmission({
        session: ctx.session,
        body: ctx.body,
        auth: ctx.auth,
        formId: 'account-settings',
        route: updateAccountSettingsDefinition,
        redirectTo: accountSettingsPageDefinition.path,
        requireAuth: {
          redirectTo: accountSettingsPageDefinition.path,
          message: 'Sign-in required to update account settings.'
        },
        validate(values) {
          const email = typeof values.email === 'string' ? values.email.trim() : '';
          const issues = [];
          if (email.length === 0) {
            issues.push({ field: 'email', message: 'Email is required.' });
          } else if (!email.includes('@')) {
            issues.push({ field: 'email', message: 'Enter a valid email address.' });
          }
          return issues;
        },
        now: ctx.now
      });
      ctx.session = submission.session;
      if (!submission.ok) {
        return submission.result;
      }

      ctx.session.profile = {
        email: typeof submission.values.email === 'string' ? submission.values.email.trim() : 'guest@example.com'
      };

      return {
        status: 303,
        redirect: { location: accountSettingsPageDefinition.path }
      };
    }
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime-forms',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http', 'auth'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
`;
}

async function assertRequestHookRuntimeBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(useFastify ? 'webstir-backend-fastify-hooks-' : 'webstir-backend-hooks-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createRequestHookRuntimeModuleSource(),
    useFastify
  });

  const port = await getOpenPort();
  const server = await startBuiltServer(workspace, port, {
    AUTH_SERVICE_TOKENS: 'service-secret'
  });

  try {
    const normalResponse = await fetch(`http://127.0.0.1:${port}/hooks/demo`, {
      headers: {
        'x-service-token': 'service-secret'
      }
    });
    assert.equal(normalResponse.status, 200);
    assert.equal(normalResponse.headers.get('x-hook-after'), '1');
    assert.deepEqual(await normalResponse.json(), {
      trace: ['beforeAuth', 'beforeHandler:service-token', 'beforeHandler:short-check', 'handler', 'afterHandler'],
      authSource: 'service-token',
      sessionId: 'session-from-hook'
    });

    const shortCircuitResponse = await fetch(`http://127.0.0.1:${port}/hooks/demo?short=1`, {
      headers: {
        'x-service-token': 'service-secret'
      }
    });
    assert.equal(shortCircuitResponse.status, 202);
    assert.deepEqual(await shortCircuitResponse.json(), {
      trace: ['beforeAuth', 'beforeHandler:service-token', 'beforeHandler:short-check'],
      authSource: 'service-token',
      sessionId: 'session-from-hook',
      shortCircuited: true
    });

    const failureResponse = await fetch(`http://127.0.0.1:${port}/hooks/demo?fail=1`, {
      headers: {
        'x-service-token': 'service-secret'
      }
    });
    assert.equal(failureResponse.status, 500);
    assert.deepEqual(await failureResponse.json(), {
      error: 'internal_error',
      message: 'request hook failed'
    });
  } finally {
    await server.stop();
  }
}

function signJwtToken(payload, secret) {
  const encodedHeader = encodeJwtSegment({ alg: 'HS256', typ: 'JWT' });
  const encodedPayload = encodeJwtSegment(payload);
  const signedContent = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', secret).update(signedContent).digest('base64url');
  return `${signedContent}.${signature}`;
}

function encodeJwtSegment(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function assertJwtTimeClaimBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(useFastify ? 'webstir-backend-fastify-auth-' : 'webstir-backend-auth-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createAuthRuntimeModuleSource(),
    useFastify
  });

  const port = await getOpenPort();
  const secret = 'jwt-test-secret';
  const issuer = 'https://issuer.example.com/';
  const audience = 'webstir-tests';
  const server = await startBuiltServer(workspace, port, {
    AUTH_JWT_SECRET: secret,
    AUTH_JWT_ISSUER: issuer,
    AUTH_JWT_AUDIENCE: audience
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const validToken = signJwtToken({
      sub: 'user-123',
      email: 'ada@example.com',
      scope: 'profile:read',
      roles: ['admin'],
      iss: issuer,
      aud: audience,
      nbf: now - 60,
      exp: now + 60
    }, secret);
    const expiredToken = signJwtToken({
      sub: 'user-123',
      iss: issuer,
      aud: audience,
      exp: now - 30
    }, secret);
    const notYetValidToken = signJwtToken({
      sub: 'user-123',
      iss: issuer,
      aud: audience,
      nbf: now + 60,
      exp: now + 120
    }, secret);

    const successResponse = await fetch(`http://127.0.0.1:${port}/auth/whoami`, {
      headers: {
        authorization: `Bearer ${validToken}`
      }
    });
    assert.equal(successResponse.status, 200);
    assert.deepEqual(await successResponse.json(), {
      source: 'jwt',
      userId: 'user-123',
      email: 'ada@example.com',
      scopes: ['profile:read'],
      roles: ['admin']
    });

    for (const token of [expiredToken, notYetValidToken]) {
      const invalidResponse = await fetch(`http://127.0.0.1:${port}/auth/whoami`, {
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      assert.equal(invalidResponse.status, 401);
      assert.deepEqual(await invalidResponse.json(), {
        error: 'unauthorized'
      });
    }
  } finally {
    await server.stop();
  }
}

async function assertRequestBodyLimitBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(
    useFastify ? 'webstir-backend-fastify-body-limit-' : 'webstir-backend-body-limit-'
  );
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createBodyLimitRuntimeModuleSource(),
    useFastify
  });

  const port = await getOpenPort();
  const server = await startBuiltServer(workspace, port, {
    REQUEST_BODY_MAX_BYTES: '16'
  });

  try {
    const acceptedResponse = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain'
      },
      body: 'small'
    });
    assert.equal(acceptedResponse.status, 200);
    assert.deepEqual(await acceptedResponse.json(), {
      echoed: 'small'
    });

    const oversizedResponse = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'text/plain'
      },
      body: 'payload-that-is-too-large'
    });
    assert.equal(oversizedResponse.status, 413);
    assert.deepEqual(await oversizedResponse.json(), {
      error: 'payload_too_large',
      message: 'Request body exceeded 16 bytes.'
    });
  } finally {
    await server.stop();
  }
}

async function assertSessionRuntimeBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(useFastify ? 'webstir-backend-fastify-session-' : 'webstir-backend-session-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createSessionRuntimeModuleSource(),
    useFastify
  });

  const port = await getOpenPort();
  const server = await startBuiltServer(workspace, port);

  try {
    const loginResponse = await fetch(`http://127.0.0.1:${port}/session/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'email=ada%40example.com',
      redirect: 'manual'
    });
    assert.equal(loginResponse.status, 303);
    assert.equal(loginResponse.headers.get('location'), '/session/account');

    const cookieHeader = extractCookieHeader(loginResponse.headers.get('set-cookie'));
    assert.match(cookieHeader, /^webstir_session=/);

    const accountResponse = await fetch(`http://127.0.0.1:${port}/session/account`, {
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(accountResponse.status, 200);
    assert.equal(accountResponse.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(
      await accountResponse.text(),
      '<main data-user="ada@example.com" data-flash="signed-in:success">ada@example.com</main>'
    );

    const secondAccountResponse = await fetch(`http://127.0.0.1:${port}/session/account`, {
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(await secondAccountResponse.text(), '<main data-user="ada@example.com" data-flash="">ada@example.com</main>');

    const logoutResponse = await fetch(`http://127.0.0.1:${port}/session/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader
      },
      redirect: 'manual'
    });
    assert.equal(logoutResponse.status, 303);
    assert.match(String(logoutResponse.headers.get('set-cookie')), /Max-Age=0/);

    const postLogoutAccountResponse = await fetch(`http://127.0.0.1:${port}/session/account`, {
      headers: {
        cookie: cookieHeader
      }
    });
    assert.equal(await postLogoutAccountResponse.text(), '<main data-user="guest" data-flash="">guest</main>');
  } finally {
    await server.stop();
  }
}

async function assertFormWorkflowRuntimeBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(useFastify ? 'webstir-backend-fastify-forms-' : 'webstir-backend-forms-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createFormWorkflowModuleSource(),
    useFastify
  });

  const port = await getOpenPort();
  const server = await startBuiltServer(workspace, port, {
    AUTH_SERVICE_TOKENS: 'service-secret'
  });

  try {
    const initialPageResponse = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      redirect: 'manual'
    });
    assert.equal(initialPageResponse.status, 200);
    const cookieHeader = extractCookieHeader(initialPageResponse.headers.get('set-cookie'));
    assert.match(cookieHeader, /^webstir_session=/);
    const initialPageHtml = await initialPageResponse.text();
    const initialCsrfToken = extractHiddenInputValue(initialPageHtml, '_csrf');
    assert.match(initialCsrfToken, /^[a-f0-9-]+$/i);
    assert.match(initialPageHtml, /data-user="guest@example\.com"/);

    const authFailureResponse = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader
      },
      body: `_csrf=${encodeURIComponent(initialCsrfToken)}&email=ada%40example.com`,
      redirect: 'manual'
    });
    assert.equal(authFailureResponse.status, 303);
    assert.equal(authFailureResponse.headers.get('location'), '/account/settings');

    const authFailurePage = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      headers: {
        cookie: cookieHeader
      }
    });
    const authFailureHtml = await authFailurePage.text();
    assert.match(authFailureHtml, /data-form-errors="Sign-in required to update account settings\."/);
    assert.match(authFailureHtml, /value="ada@example\.com"/);
    const validationCsrfToken = extractHiddenInputValue(authFailureHtml, '_csrf');

    const validationFailureResponse = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader,
        'x-service-token': 'service-secret'
      },
      body: `_csrf=${encodeURIComponent(validationCsrfToken)}&email=invalid-email`,
      redirect: 'manual'
    });
    assert.equal(validationFailureResponse.status, 303);
    assert.equal(validationFailureResponse.headers.get('location'), '/account/settings');

    const validationFailurePage = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      headers: {
        cookie: cookieHeader
      }
    });
    const validationFailureHtml = await validationFailurePage.text();
    assert.match(validationFailureHtml, /data-field-errors="Enter a valid email address\."/);
    assert.match(validationFailureHtml, /value="invalid-email"/);
    const successCsrfToken = extractHiddenInputValue(validationFailureHtml, '_csrf');

    const csrfFailureResponse = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader,
        'x-service-token': 'service-secret'
      },
      body: `_csrf=wrong-token&email=ada%40example.com`,
      redirect: 'manual'
    });
    assert.equal(csrfFailureResponse.status, 303);
    assert.equal(csrfFailureResponse.headers.get('location'), '/account/settings');

    const csrfFailurePage = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      headers: {
        cookie: cookieHeader
      }
    });
    const csrfFailureHtml = await csrfFailurePage.text();
    assert.match(csrfFailureHtml, /data-form-errors="Form session expired\. Reload the page and try again\."/);

    const successResponse = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader,
        'x-service-token': 'service-secret'
      },
      body: `_csrf=${encodeURIComponent(successCsrfToken)}&email=ada%40example.com`,
      redirect: 'manual'
    });
    assert.equal(successResponse.status, 303);
    assert.equal(successResponse.headers.get('location'), '/account/settings');

    const successPage = await fetch(`http://127.0.0.1:${port}/account/settings`, {
      headers: {
        cookie: cookieHeader
      }
    });
    const successHtml = await successPage.text();
    assert.match(successHtml, /data-user="ada@example\.com"/);
    assert.match(successHtml, /data-flash="settings-saved:success"/);
    assert.match(successHtml, /data-form-errors=""/);
    assert.match(successHtml, /data-field-errors=""/);
  } finally {
    await server.stop();
  }
}

function createViewRuntimeModuleSource() {
  return `const loginRoute = {
  definition: {
    name: 'viewSessionLogin',
    method: 'POST',
    path: '/session/login',
    interaction: 'mutation',
    form: {
      contentType: 'application/x-www-form-urlencoded',
      session: { write: true }
    }
  },
  handler: async (ctx) => {
    const email = String(ctx.body?.email ?? 'viewer@example.com');
    ctx.session = {
      userId: email,
      profile: { email }
    };
    return {
      status: 303,
      redirect: { location: '/accounts/demo' }
    };
  }
};

const accountView = {
  definition: {
    name: 'AccountView',
    path: '/accounts/:id',
    renderMode: 'ssr'
  },
  load: async (ctx) => ({
    accountId: ctx.params.id,
    authSource: ctx.auth?.source ?? null,
    sessionUser: ctx.session?.userId ?? null,
    requestId: ctx.requestId ?? null,
    pathname: ctx.url.pathname,
    host: ctx.headers.host ?? null
  })
};

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime-views',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http', 'auth', 'views'],
    routes: [loginRoute.definition],
    views: [accountView.definition]
  },
  routes: [loginRoute],
  views: [accountView]
};
`;
}

async function assertRequestTimeViewRuntimeBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(
    useFastify ? 'webstir-backend-fastify-views-' : 'webstir-backend-views-'
  );
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createViewRuntimeModuleSource(),
    useFastify
  });
  await writeFrontendDocument(
    workspace,
    'accounts',
    [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head><title>Account shell</title></head>',
      '<body><main><h1>Account shell</h1></main></body>',
      '</html>'
    ].join('\n')
  );

  const port = await getOpenPort();
  const server = await startBuiltServer(workspace, port, {
    AUTH_SERVICE_TOKENS: 'service-secret'
  });

  try {
    const loginResponse = await fetch(`http://127.0.0.1:${port}/session/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'email=viewer%40example.com',
      redirect: 'manual'
    });
    assert.equal(loginResponse.status, 303);
    assert.equal(loginResponse.headers.get('location'), '/accounts/demo');

    const cookieHeader = extractCookieHeader(loginResponse.headers.get('set-cookie'));
    assert.match(cookieHeader, /^webstir_session=/);

    const accountResponse = await fetch(`http://127.0.0.1:${port}/accounts/demo`, {
      headers: {
        cookie: cookieHeader,
        'x-service-token': 'service-secret'
      }
    });
    assert.equal(accountResponse.status, 200);
    assert.equal(accountResponse.headers.get('cache-control'), 'no-store');
    assert.equal(accountResponse.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(accountResponse.headers.get('x-webstir-document-cache'), 'miss');
    const requestId = accountResponse.headers.get('x-request-id');
    assert.ok(requestId, 'Expected request-time view responses to expose x-request-id.');

    const accountHtml = await accountResponse.text();
    assert.match(accountHtml, /<h1>Account shell<\/h1>/);
    assert.match(accountHtml, /data-webstir-view-name="AccountView"/);
    assert.match(accountHtml, /data-webstir-view-pathname="\/accounts\/demo"/);

    const viewState = extractViewState(accountHtml);
    assert.deepEqual(viewState, {
      view: {
        name: 'AccountView',
        path: '/accounts/:id',
        pathname: '/accounts/demo',
        params: { id: 'demo' }
      },
      data: {
        accountId: 'demo',
        authSource: 'service-token',
        sessionUser: 'viewer@example.com',
        requestId,
        pathname: '/accounts/demo',
        host: `127.0.0.1:${port}`
      },
      requestId
    });

    const cachedAccountResponse = await fetch(`http://127.0.0.1:${port}/accounts/demo`, {
      headers: {
        cookie: cookieHeader,
        'x-service-token': 'service-secret'
      }
    });
    assert.equal(cachedAccountResponse.status, 200);
    assert.equal(cachedAccountResponse.headers.get('x-webstir-document-cache'), 'hit');
    const cachedAccountHtml = await cachedAccountResponse.text();
    assert.match(cachedAccountHtml, /<h1>Account shell<\/h1>/);

    await writeFrontendDocument(
      workspace,
      'accounts',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head><title>Account shell refreshed</title></head>',
        '<body><main><h1>Account shell refreshed</h1><p>Updated shell</p></main></body>',
        '</html>'
      ].join('\n')
    );

    const refreshedAccountResponse = await fetch(`http://127.0.0.1:${port}/accounts/demo`, {
      headers: {
        cookie: cookieHeader,
        'x-service-token': 'service-secret'
      }
    });
    assert.equal(refreshedAccountResponse.status, 200);
    assert.equal(refreshedAccountResponse.headers.get('x-webstir-document-cache'), 'stale');
    const refreshedAccountHtml = await refreshedAccountResponse.text();
    assert.match(refreshedAccountHtml, /<h1>Account shell refreshed<\/h1>/);
    assert.match(refreshedAccountHtml, /<p>Updated shell<\/p>/);

    const warmAccountResponse = await fetch(`http://127.0.0.1:${port}/accounts/demo`, {
      headers: {
        cookie: cookieHeader,
        'x-service-token': 'service-secret'
      }
    });
    assert.equal(warmAccountResponse.status, 200);
    assert.equal(warmAccountResponse.headers.get('x-webstir-document-cache'), 'hit');

    const missingResponse = await fetch(`http://127.0.0.1:${port}/missing-page`);
    assert.equal(missingResponse.status, 404);
    assert.deepEqual(await missingResponse.json(), {
      error: 'not_found',
      path: '/missing-page'
    });
  } finally {
    await server.stop();
  }
}

async function assertRequestTimeViewWorkspaceRootBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(
    useFastify ? 'webstir-backend-fastify-view-root-' : 'webstir-backend-view-root-'
  );
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createViewRuntimeModuleSource(),
    useFastify
  });
  await writePublishedFrontendAliasDocument(
    workspace,
    'accounts',
    [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head><title>Published account shell</title></head>',
      '<body><main><h1>Published account shell</h1></main></body>',
      '</html>'
    ].join('\n')
  );

  const port = await getOpenPort();
  const alternateCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-backend-alt-cwd-'));
  const server = await startBuiltServer(
    workspace,
    port,
    {
      AUTH_SERVICE_TOKENS: 'service-secret',
      WORKSPACE_ROOT: workspace
    },
    {
      cwd: alternateCwd
    }
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}/accounts/demo`, {
      headers: {
        'x-service-token': 'service-secret'
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-webstir-document-cache'), 'miss');
    const html = await response.text();
    assert.match(html, /<h1>Published account shell<\/h1>/);
    assert.match(html, /data-webstir-view-pathname="\/accounts\/demo"/);
  } finally {
    await server.stop();
  }
}

function createFragmentRuntimeModuleSource() {
  return `const routes = [
  {
    definition: {
      name: 'redirectRoute',
      method: 'POST',
      path: '/actions/redirect',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' }
    },
    handler: async (ctx) => ({
      status: 303,
      redirect: {
        location: \`/done?name=\${encodeURIComponent(String(ctx.body?.name ?? 'unknown'))}\`
      }
    })
  },
  {
    definition: {
      name: 'fragmentRoute',
      method: 'POST',
      path: '/actions/fragment',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' },
      fragment: { target: 'greeting', mode: 'replace' }
    },
    handler: async (ctx) => ({
      status: 200,
      fragment: {
        target: 'greeting',
        mode: 'replace',
        body: \`<p>Hello \${String(ctx.body?.name ?? 'world')}</p>\`
      }
    })
  },
  {
    definition: {
      name: 'fragmentMissingTargetRoute',
      method: 'POST',
      path: '/actions/fragment-missing-target',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' }
    },
    handler: async () => ({
      status: 200,
      fragment: {
        target: '   ',
        mode: 'replace',
        body: '<p>Missing target</p>'
      }
    })
  },
  {
    definition: {
      name: 'fragmentInvalidModeRoute',
      method: 'POST',
      path: '/actions/fragment-invalid-mode',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' }
    },
    handler: async () => ({
      status: 200,
      fragment: {
        target: 'greeting',
        mode: 'swap',
        body: '<p>Invalid mode</p>'
      }
    })
  },
  {
    definition: {
      name: 'fragmentInvalidSelectorRoute',
      method: 'POST',
      path: '/actions/fragment-invalid-selector',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' }
    },
    handler: async () => ({
      status: 200,
      fragment: {
        target: 'greeting',
        selector: '   ',
        mode: 'replace',
        body: '<p>Invalid selector</p>'
      }
    })
  },
  {
    definition: {
      name: 'fragmentMissingBodyRoute',
      method: 'POST',
      path: '/actions/fragment-missing-body',
      interaction: 'mutation',
      form: { contentType: 'application/x-www-form-urlencoded' }
    },
    handler: async () => ({
      status: 200,
      fragment: {
        target: 'greeting',
        mode: 'replace'
      }
    })
  }
];

export const module = {
  manifest: {
    contractVersion: '1.0.0',
    name: '@demo/runtime',
    version: '0.1.0',
    kind: 'backend',
    capabilities: ['http'],
    routes: routes.map((route) => route.definition)
  },
  routes
};
`;
}

async function assertFragmentRuntimeBehavior({ useFastify }) {
  const workspace = await createTempWorkspace(
    useFastify ? 'webstir-backend-fastify-fragments-' : 'webstir-backend-fragments-'
  );
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createFragmentRuntimeModuleSource(),
    useFastify
  });

  const port = await getOpenPort();
  const server = await startBuiltServer(workspace, port);

  try {
    const redirectResponse = await fetch(`http://127.0.0.1:${port}/actions/redirect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'name=Webstir',
      redirect: 'manual'
    });
    assert.equal(redirectResponse.status, 303);
    assert.equal(redirectResponse.headers.get('location'), '/done?name=Webstir');

    const fragmentResponse = await fetch(`http://127.0.0.1:${port}/actions/fragment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'name=Webstir'
    });
    assert.equal(fragmentResponse.status, 200);
    assert.equal(fragmentResponse.headers.get('cache-control'), 'no-store');
    assert.equal(fragmentResponse.headers.get('x-webstir-fragment-cache'), 'bypass');
    assert.equal(fragmentResponse.headers.get('x-webstir-fragment-target'), 'greeting');
    assert.equal(fragmentResponse.headers.get('x-webstir-fragment-mode'), 'replace');
    assert.equal(fragmentResponse.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await fragmentResponse.text(), '<p>Hello Webstir</p>');

    for (const pathname of [
      '/actions/fragment-missing-target',
      '/actions/fragment-invalid-mode',
      '/actions/fragment-invalid-selector',
      '/actions/fragment-missing-body'
    ]) {
      const invalidResponse = await fetch(`http://127.0.0.1:${port}${pathname}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: 'name=Webstir'
      });
      assert.equal(invalidResponse.status, 500);
      assert.equal(invalidResponse.headers.get('x-webstir-fragment-target'), null);
      assert.match(String(invalidResponse.headers.get('content-type')), /^application\/json\b/);
      assert.deepEqual(await invalidResponse.json(), {
        errors: [
          {
            code: 'invalid_fragment_response',
            message: 'Fragment responses require a non-empty target, supported mode, and body.',
            details:
              pathname === '/actions/fragment-missing-target'
                ? ['target']
                : pathname === '/actions/fragment-invalid-mode'
                  ? ['mode']
                  : pathname === '/actions/fragment-invalid-selector'
                    ? ['selector']
                  : ['body']
          }
        ]
      });
    }
  } finally {
    await server.stop();
  }
}

test('request hook scaffold helper preserves ordered phase execution', async () => {
  const workspace = await createTempWorkspace('webstir-backend-hook-helper-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createRequestHookRuntimeModuleSource(),
    mode: 'build'
  });

  const helperBuildPath = path.join(workspace, 'build', 'request-hooks.mjs');
  await esbuild({
    entryPoints: [path.join(workspace, 'src', 'backend', 'runtime', 'request-hooks.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: helperBuildPath,
    logLevel: 'silent'
  });
  const helperUrl = pathToFileURL(helperBuildPath).href;
  const { executeRequestHookPhase, resolveRequestHooks } = await import(helperUrl);

  const context = {
    trace: [],
    auth: undefined,
    session: null
  };
  const route = { name: 'hookRoute', path: '/hooks/demo' };
  const resolved = resolveRequestHooks({
    routeName: route.name,
    routeReferences: [{ id: 'after' }, { id: 'short' }, { id: 'auth' }, { id: 'session' }],
    manifestDefinitions: [
      { id: 'session', phase: 'beforeAuth', order: 10 },
      { id: 'short', phase: 'beforeHandler', order: 20 },
      { id: 'auth', phase: 'beforeHandler', order: 10 },
      { id: 'after', phase: 'afterHandler', order: 10 }
    ],
    registrations: [
      {
        id: 'session',
        handler: async (ctx) => {
          ctx.trace.push('beforeAuth');
          ctx.session = { id: 'session-from-hook' };
        }
      },
      {
        id: 'auth',
        handler: async (ctx) => {
          ctx.auth = { source: 'service-token' };
          ctx.trace.push(`beforeHandler:${ctx.auth.source}`);
        }
      },
      {
        id: 'short',
        handler: async (ctx) => {
          ctx.trace.push('beforeHandler:short-check');
          return ctx.shortCircuit
            ? {
                status: 202,
                body: {
                  trace: [...ctx.trace],
                  authSource: ctx.auth?.source ?? null,
                  sessionId: ctx.session?.id ?? null,
                  shortCircuited: true
                }
              }
            : undefined;
        }
      },
      {
        id: 'after',
        handler: async (ctx, input) => ({
          ...input.result,
          headers: {
            ...(input.result?.headers ?? {}),
            'x-hook-after': '1'
          },
          body: {
            ...(input.result?.body ?? {}),
            trace: [...(input.result?.body?.trace ?? []), 'afterHandler'],
            authSource: input.result?.body?.authSource ?? ctx.auth?.source ?? null,
            sessionId: input.result?.body?.sessionId ?? ctx.session?.id ?? null
          }
        })
      }
    ]
  });

  assert.deepEqual(
    resolved.hooks.map((hook) => `${hook.phase}:${hook.id}`),
    ['beforeAuth:session', 'beforeHandler:auth', 'beforeHandler:short', 'afterHandler:after']
  );

  await executeRequestHookPhase({
    hooks: resolved.hooks,
    phase: 'beforeAuth',
    context,
    route
  });
  const beforeHandler = await executeRequestHookPhase({
    hooks: resolved.hooks,
    phase: 'beforeHandler',
    context,
    route
  });

  assert.equal(beforeHandler.shortCircuited, false);

  const afterHandler = await executeRequestHookPhase({
    hooks: resolved.hooks,
    phase: 'afterHandler',
    context,
    route,
    result: {
      status: 200,
      body: {
        trace: [...context.trace, 'handler'],
        authSource: context.auth?.source ?? null,
        sessionId: context.session?.id ?? null
      }
    }
  });

  assert.deepEqual(afterHandler.result, {
    status: 200,
    headers: {
      'x-hook-after': '1'
    },
    body: {
      trace: ['beforeAuth', 'beforeHandler:service-token', 'beforeHandler:short-check', 'handler', 'afterHandler'],
      authSource: 'service-token',
      sessionId: 'session-from-hook'
    }
  });

  const shortContext = {
    trace: [],
    auth: undefined,
    session: null,
    shortCircuit: true
  };
  await executeRequestHookPhase({
    hooks: resolved.hooks,
    phase: 'beforeAuth',
    context: shortContext,
    route
  });
  const shortCircuitResult = await executeRequestHookPhase({
    hooks: resolved.hooks,
    phase: 'beforeHandler',
    context: shortContext,
    route
  });

  assert.equal(shortCircuitResult.shortCircuited, true);
  assert.deepEqual(shortCircuitResult.result, {
    status: 202,
    body: {
      trace: ['beforeAuth', 'beforeHandler:service-token', 'beforeHandler:short-check'],
      authSource: 'service-token',
      sessionId: 'session-from-hook',
      shortCircuited: true
    }
  });
});

test('node-http scaffold helper loads module runtime and preserves response semantics', async () => {
  const workspace = await createTempWorkspace('webstir-backend-node-http-helper-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createRequestHookRuntimeModuleSource(),
    mode: 'build'
  });

  const helperBuildPath = path.join(workspace, 'build', 'node-http.mjs');
  await esbuild({
    entryPoints: [path.join(workspace, 'src', 'backend', 'runtime', 'node-http.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: helperBuildPath,
    logLevel: 'silent'
  });
  const helperUrl = pathToFileURL(helperBuildPath).href;
  const {
    createReadinessTracker,
    loadModuleRuntime,
    matchRoute,
    normalizeRouteHandlerResult,
    summarizeManifest
  } = await import(helperUrl);

  const runtime = await loadModuleRuntime({
    importMetaUrl: pathToFileURL(path.join(workspace, 'build', 'backend', 'index.js')).href
  });

  assert.equal(runtime.source, 'module.js');
  assert.deepEqual(runtime.warnings, []);
  assert.deepEqual(
    runtime.routes.map((route) => `${route.method} ${route.definition?.path ?? ''}`),
    ['GET /hooks/demo']
  );
  assert.deepEqual(summarizeManifest(runtime.manifest), {
    name: '@demo/runtime-hooks',
    version: '0.1.0',
    routes: 1,
    views: 0,
    capabilities: ['http', 'auth']
  });

  const matched = matchRoute(runtime.routes, 'get', '/hooks/demo');
  assert.ok(matched, 'expected route match');
  assert.equal(matched?.route.name, 'hookRoute');
  assert.deepEqual(matched?.params, {});

  const readiness = createReadinessTracker();
  assert.deepEqual(readiness.snapshot(), { status: 'booting', message: undefined });
  readiness.error('load failed');
  assert.deepEqual(readiness.snapshot(), { status: 'error', message: 'load failed' });
  readiness.ready();
  assert.deepEqual(readiness.snapshot(), { status: 'ready', message: undefined });

  const invalidFragmentResult = normalizeRouteHandlerResult({
    status: 200,
    fragment: {
      target: ' ',
      body: '<main>bad</main>'
    }
  });
  assert.equal(invalidFragmentResult.status, 500);
  assert.deepEqual(invalidFragmentResult.errors, [
    {
      code: 'invalid_fragment_response',
      message: 'Fragment responses require a non-empty target, supported mode, and body.',
      details: ['target']
    }
  ]);
});

test('session scaffold helper resolves, consumes, and invalidates session state', async () => {
  const workspace = await createTempWorkspace('webstir-backend-session-helper-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createSessionRuntimeModuleSource(),
    mode: 'build'
  });

  const helperBuildPath = path.join(workspace, 'build', 'session.mjs');
  await esbuild({
    entryPoints: [path.join(workspace, 'src', 'backend', 'runtime', 'session.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: helperBuildPath,
    logLevel: 'silent'
  });
  const helperUrl = pathToFileURL(helperBuildPath).href;
  const { prepareSessionState, resetInMemorySessionStore } = await import(helperUrl);
  resetInMemorySessionStore();

  const config = {
    secret: 'test-session-secret',
    cookieName: 'webstir_session',
    secure: false,
    maxAgeSeconds: 60
  };
  const loginRoute = {
    form: {
      session: { write: true },
      flash: {
        publish: [{ key: 'signed-in', level: 'success', when: 'success' }]
      }
    }
  };
  const accountRoute = {
    session: { mode: 'optional' },
    flash: { consume: ['signed-in'] }
  };

  const created = prepareSessionState({
    cookies: '',
    route: loginRoute,
    config
  });
  assert.equal(created.session, null);
  assert.deepEqual(created.flash, []);

  const createdCommit = created.commit({
    session: {
      userId: 'ada@example.com',
      data: { email: 'ada@example.com' }
    },
    route: loginRoute,
    result: {
      status: 303,
      redirect: { location: '/session/account' }
    }
  });
  const cookieHeader = extractCookieHeader(createdCommit.setCookie);
  assert.match(cookieHeader, /^webstir_session=/);

  const firstRead = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config
  });
  assert.equal(firstRead.session.userId, 'ada@example.com');
  assert.deepEqual(
    firstRead.flash.map((message) => ({ key: message.key, level: message.level })),
    [{ key: 'signed-in', level: 'success' }]
  );
  const firstReadCommit = firstRead.commit({
    session: firstRead.session,
    route: accountRoute,
    result: {
      status: 200,
      body: '<main>ok</main>'
    }
  });
  assert.equal(firstReadCommit.setCookie, undefined);

  const secondRead = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config
  });
  assert.equal(secondRead.session.userId, 'ada@example.com');
  assert.deepEqual(secondRead.flash, []);

  const invalidated = secondRead.commit({
    session: null,
    route: accountRoute,
    result: {
      status: 303,
      redirect: { location: '/signed-out' }
    }
  });
  assert.match(String(invalidated.setCookie), /Max-Age=0/);

  const afterInvalidation = prepareSessionState({
    cookies: cookieHeader,
    route: accountRoute,
    config
  });
  assert.equal(afterInvalidation.session, null);
  assert.deepEqual(afterInvalidation.flash, []);
});

test('form scaffold helper redirects validation and auth failures with csrf protection', async () => {
  const workspace = await createTempWorkspace('webstir-backend-form-helper-');
  await buildRuntimeWorkspace(workspace, {
    moduleSource: createFormWorkflowModuleSource(),
    mode: 'build'
  });

  const helperBuildPath = path.join(workspace, 'build', 'forms.mjs');
  await esbuild({
    entryPoints: [path.join(workspace, 'src', 'backend', 'runtime', 'forms.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: helperBuildPath,
    logLevel: 'silent'
  });
  const helperUrl = pathToFileURL(helperBuildPath).href;
  const { groupFormIssuesByField, prepareFormState, processFormSubmission } = await import(helperUrl);

  const pageRoute = {
    path: '/account/settings'
  };
  const submitRoute = {
    path: '/account/settings',
    form: {
      csrf: true
    }
  };

  const initialPage = prepareFormState({
    session: null,
    formId: 'account-settings',
    route: submitRoute
  });
  assert.match(String(initialPage.csrfToken), /^[a-f0-9-]+$/i);
  assert.deepEqual(initialPage.values, {});
  assert.deepEqual(initialPage.issues, []);

  const authFailure = processFormSubmission({
    session: initialPage.session,
    body: {
      _csrf: initialPage.csrfToken,
      email: 'ada@example.com'
    },
    auth: undefined,
    formId: 'account-settings',
    route: submitRoute,
    redirectTo: pageRoute.path,
    requireAuth: {
      redirectTo: pageRoute.path,
      message: 'Sign-in required to update account settings.'
    }
  });
  assert.equal(authFailure.ok, false);
  assert.deepEqual(authFailure.result, {
    status: 303,
    redirect: {
      location: '/account/settings'
    }
  });

  const authFailurePage = prepareFormState({
    session: authFailure.session,
    formId: 'account-settings',
    route: submitRoute
  });
  assert.deepEqual(groupFormIssuesByField(authFailurePage.issues), {
    form: ['Sign-in required to update account settings.'],
    fields: {}
  });
  assert.equal(authFailurePage.values.email, 'ada@example.com');

  const validationFailure = processFormSubmission({
    session: authFailurePage.session,
    body: {
      _csrf: authFailurePage.csrfToken,
      email: 'invalid-email'
    },
    auth: { source: 'service-token' },
    formId: 'account-settings',
    route: submitRoute,
    redirectTo: pageRoute.path,
    validate(values) {
      return typeof values.email === 'string' && values.email.includes('@')
        ? []
        : [{ field: 'email', message: 'Enter a valid email address.' }];
    }
  });
  assert.equal(validationFailure.ok, false);

  const validationFailurePage = prepareFormState({
    session: validationFailure.session,
    formId: 'account-settings',
    route: submitRoute
  });
  assert.deepEqual(groupFormIssuesByField(validationFailurePage.issues), {
    form: [],
    fields: {
      email: ['Enter a valid email address.']
    }
  });
  assert.equal(validationFailurePage.values.email, 'invalid-email');

  const csrfFailure = processFormSubmission({
    session: validationFailurePage.session,
    body: {
      _csrf: 'wrong-token',
      email: 'ada@example.com'
    },
    auth: { source: 'service-token' },
    formId: 'account-settings',
    route: submitRoute,
    redirectTo: pageRoute.path
  });
  assert.equal(csrfFailure.ok, false);

  const csrfFailurePage = prepareFormState({
    session: csrfFailure.session,
    formId: 'account-settings',
    route: submitRoute
  });
  assert.deepEqual(groupFormIssuesByField(csrfFailurePage.issues), {
    form: ['Form session expired. Reload the page and try again.'],
    fields: {}
  });

  const success = processFormSubmission({
    session: csrfFailurePage.session,
    body: {
      _csrf: csrfFailurePage.csrfToken,
      email: 'ada@example.com'
    },
    auth: { source: 'service-token' },
    formId: 'account-settings',
    route: submitRoute,
    redirectTo: pageRoute.path,
    validate(values) {
      return typeof values.email === 'string' && values.email.includes('@')
        ? []
        : [{ field: 'email', message: 'Enter a valid email address.' }];
    }
  });
  assert.equal(success.ok, true);
  assert.equal(success.values.email, 'ada@example.com');

  const successPage = prepareFormState({
    session: success.session,
    formId: 'account-settings',
    route: submitRoute
  });
  assert.deepEqual(successPage.issues, []);
  assert.deepEqual(successPage.values, {});
});

test('request hook scaffold builds for default and fastify entries', async () => {
  const defaultWorkspace = await createTempWorkspace('webstir-backend-default-hooks-build-');
  await buildRuntimeWorkspace(defaultWorkspace, {
    moduleSource: createRequestHookRuntimeModuleSource(),
    mode: 'build'
  });
  assert.equal(fssync.existsSync(path.join(defaultWorkspace, 'src', 'backend', 'runtime', 'node-http.ts')), true);
  assert.equal(fssync.existsSync(path.join(defaultWorkspace, 'src', 'backend', 'runtime', 'fastify.ts')), true);
  assert.equal(fssync.existsSync(path.join(defaultWorkspace, 'src', 'backend', 'runtime', 'forms.ts')), true);
  assert.equal(fssync.existsSync(path.join(defaultWorkspace, 'src', 'backend', 'runtime', 'request-hooks.ts')), true);
  assert.equal(fssync.existsSync(path.join(defaultWorkspace, 'src', 'backend', 'runtime', 'session.ts')), true);
  assert.equal(fssync.existsSync(path.join(defaultWorkspace, 'src', 'backend', 'runtime', 'views.ts')), true);
  assert.equal(fssync.existsSync(path.join(defaultWorkspace, 'build', 'backend', 'index.js')), true);

  const fastifyWorkspace = await createTempWorkspace('webstir-backend-fastify-hooks-build-');
  await buildRuntimeWorkspace(fastifyWorkspace, {
    moduleSource: createRequestHookRuntimeModuleSource(),
    useFastify: true,
    mode: 'build'
  });
  assert.equal(fssync.existsSync(path.join(fastifyWorkspace, 'src', 'backend', 'runtime', 'node-http.ts')), true);
  assert.equal(fssync.existsSync(path.join(fastifyWorkspace, 'src', 'backend', 'runtime', 'fastify.ts')), true);
  assert.equal(fssync.existsSync(path.join(fastifyWorkspace, 'src', 'backend', 'runtime', 'forms.ts')), true);
  assert.equal(fssync.existsSync(path.join(fastifyWorkspace, 'src', 'backend', 'runtime', 'request-hooks.ts')), true);
  assert.equal(fssync.existsSync(path.join(fastifyWorkspace, 'src', 'backend', 'runtime', 'session.ts')), true);
  assert.equal(fssync.existsSync(path.join(fastifyWorkspace, 'src', 'backend', 'runtime', 'views.ts')), true);
  assert.equal(fssync.existsSync(path.join(fastifyWorkspace, 'build', 'backend', 'index.js')), true);
});

function extractCookieHeader(setCookie) {
  return String(setCookie ?? '').split(';')[0];
}

function extractHiddenInputValue(html, name) {
  const pattern = new RegExp(`<input[^>]+name="${name}"[^>]+value="([^"]*)"`, 'i');
  const match = pattern.exec(String(html));
  assert.ok(match, `Expected hidden input ${name} to exist.`);
  return match[1];
}

function extractViewState(html) {
  const match = /<script type="application\/json" id="webstir-view-state">([\s\S]*?)<\/script>/i.exec(String(html));
  assert.ok(match, 'Expected request-time view payload to be injected.');
  return JSON.parse(match[1]);
}

async function onceExit(child) {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => child.once('exit', resolve));
}

async function canConnectToPort(port) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const settle = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => settle(true));
    socket.once('error', () => settle(false));
    socket.setTimeout(200, () => settle(false));
  });
}

async function waitFor(checkFn, timeoutMs = 5000, pollMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkFn()) {
      return;
    }
    await delay(pollMs);
  }
  throw new Error('waitFor timed out');
}

test('build mode produces transpiled output and manifest', async () => {
  const workspace = await createTempWorkspace();
  await hydrateBackendScaffold(workspace);

  const bin = getLocalBinPath();
  const env = {
    WEBSTIR_MODULE_MODE: 'build',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const buildRoot = path.join(workspace, 'build', 'backend');
  const outFile = path.join(buildRoot, 'index.js');
  assert.equal(fssync.existsSync(outFile), true, 'expected build/backend/index.js to exist');

  assert.ok(Array.isArray(result.manifest.entryPoints));
  assert.ok(result.manifest.entryPoints.some((e) => e.endsWith('index.js')));
});

test('publish mode bundles output and manifest has entry', async () => {
  const workspace = await createTempWorkspace();
  await hydrateBackendScaffold(workspace);

  const bin = getLocalBinPath();
  const env = {
    WEBSTIR_MODULE_MODE: 'publish',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const buildRoot = path.join(workspace, 'build', 'backend');
  const outFile = path.join(buildRoot, 'index.js');
  assert.equal(fssync.existsSync(outFile), true, 'expected build/backend/index.js to exist');

  assert.ok(result.manifest.entryPoints.length >= 1);
});

test('publish mode emits sourcemaps when opt-in flag is set', async () => {
  const workspace = await createTempWorkspace();
  await hydrateBackendScaffold(workspace);

  const bin = getLocalBinPath();
  const env = {
    WEBSTIR_MODULE_MODE: 'publish',
    WEBSTIR_BACKEND_SOURCEMAPS: 'on',
    WEBSTIR_BACKEND_TYPECHECK: 'skip',
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
  };

  const result = await backendProvider.build({ workspaceRoot: workspace, env, incremental: false });

  const buildRoot = path.join(workspace, 'build', 'backend');
  const mapFile = path.join(buildRoot, 'index.js.map');
  assert.equal(fssync.existsSync(mapFile), true, 'expected build/backend/index.js.map to exist');
  assert.ok(
    result.artifacts.some((artifact) => artifact.path.endsWith('index.js.map') && artifact.type === 'asset'),
    'expected index.js.map to be included as an asset artifact'
  );
});

test('built backend server validates fragment route responses', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertFragmentRuntimeBehavior({ useFastify: false });
});

test('fastify backend scaffold validates fragment route responses', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertFragmentRuntimeBehavior({ useFastify: true });
});

test('built backend server executes request hooks with ordered context handoff', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestHookRuntimeBehavior({ useFastify: false });
});

test('fastify backend scaffold executes request hooks with ordered context handoff', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestHookRuntimeBehavior({ useFastify: true });
});

test('built backend server enforces jwt exp and nbf claims', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertJwtTimeClaimBehavior({ useFastify: false });
});

test('fastify backend scaffold enforces jwt exp and nbf claims', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertJwtTimeClaimBehavior({ useFastify: true });
});

test('built backend server resolves session state and flash transport', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertSessionRuntimeBehavior({ useFastify: false });
});

test('fastify backend scaffold resolves session state and flash transport', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertSessionRuntimeBehavior({ useFastify: true });
});

test('built backend server rejects oversized request bodies with 413', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestBodyLimitBehavior({ useFastify: false });
});

test('fastify backend scaffold rejects oversized request bodies with 413', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestBodyLimitBehavior({ useFastify: true });
});

test('built backend server handles auth-aware form workflows with csrf and validation', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertFormWorkflowRuntimeBehavior({ useFastify: false });
});

test('fastify backend scaffold handles auth-aware form workflows with csrf and validation', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertFormWorkflowRuntimeBehavior({ useFastify: true });
});

test('built backend server renders request-time views with live SSR context', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestTimeViewRuntimeBehavior({ useFastify: false });
});

test('fastify backend scaffold renders request-time views with live SSR context', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestTimeViewRuntimeBehavior({ useFastify: true });
});

test('built backend server resolves request-time view documents from WORKSPACE_ROOT outside the workspace cwd', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestTimeViewWorkspaceRootBehavior({ useFastify: false });
});

test('fastify backend scaffold resolves request-time view documents from WORKSPACE_ROOT outside the workspace cwd', async (t) => {
  if (!(await canListenOnTcp())) {
    t.skip('TCP listen is not permitted in this environment.');
    return;
  }

  await assertRequestTimeViewWorkspaceRootBehavior({ useFastify: true });
});

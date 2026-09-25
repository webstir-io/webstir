import { afterEach, expect, test } from 'bun:test';

import { runBuild } from '../src/build.ts';
import { removeDemoWorkspace, type DemoWorkspaceCopy } from '../test-support/demo-workspace.ts';
import {
  CLIENTS_DATA_SCHEMA,
  addBackendModuleCode,
  cookieFrom,
  copyDesignClientsPage,
  copyFullWorkspace,
  csrfTokenFrom,
  startBuiltBackend,
} from '../test-support/render-workspace.ts';
import { stopTrackedChildren } from '../test-support/watch.ts';

const copies: DemoWorkspaceCopy[] = [];
const childProcesses: Array<ReturnType<typeof Bun.spawn>> = [];

afterEach(async () => {
  await stopTrackedChildren(childProcesses);
  await Promise.all(copies.splice(0).map((copy) => removeDemoWorkspace(copy)));
});

const CLIENTS_MODULE = `import { processFormSubmission } from '@webstir-io/webstir-backend/runtime/forms';

const clientList = [{ name: 'Acme Logistics', href: '/clients/acme/' }];

const createClientDefinition = {
  name: 'createClient',
  method: 'POST',
  path: '/clients/',
  interaction: 'mutation',
  form: {
    contentType: 'application/x-www-form-urlencoded',
    csrf: true,
    session: { write: true },
  },
} as const;

const createClientRoute = {
  definition: createClientDefinition,
  handler: async (ctx: any) => {
    const submission = processFormSubmission({
      session: ctx.session,
      body: ctx.body,
      formId: 'createClient',
      route: createClientDefinition,
      rerender: 'clientsPage',
      validate: (values) => {
        const issues = [];
        if (String(values.name ?? '').trim().length < 2) {
          issues.push({ field: 'name', message: 'Use at least two characters.' });
        }
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(values.slug ?? ''))) {
          issues.push({ field: 'slug', message: 'Use lowercase letters, numbers and dashes.' });
        }
        return issues;
      },
    });
    ctx.session = submission.session;
    if (!submission.ok) {
      return submission.result;
    }
    const slug = String(submission.values.slug);
    clientList.push({ name: String(submission.values.name).trim(), href: \`/clients/\${slug}/\` });
    return { status: 303, redirect: { location: '/clients/' } };
  },
};

const clientsView = {
  definition: { name: 'clientsPage', path: '/clients/', page: 'clients' },
  data: ${CLIENTS_DATA_SCHEMA},
  load: (ctx: any) => {
    const form = ctx.forms.read('createClient');
    return {
      nav: { proposals: null, clients: { current: 'page' } },
      clients: clientList,
      create: { open: form.submitted, values: form.values, issues: form.errors },
    };
  },
};
`;

test('an invalid submission comes back as 422 with its errors in the HTML, JavaScript off', async () => {
  const workspace = await copyFullWorkspace(copies);
  await copyDesignClientsPage(workspace);
  await addBackendModuleCode(workspace, CLIENTS_MODULE, { routes: ['createClientRoute'] });
  await runBuild({ workspaceRoot: workspace });
  const origin = await startBuiltBackend(workspace, childProcesses, '/clients/');

  const page = await fetch(`${origin}/clients/`);
  expect(page.status).toBe(200);
  const pageHtml = await page.text();
  const cookie = cookieFrom(page);
  const token = csrfTokenFrom(pageHtml);
  expect(pageHtml).toContain('<details class="management-panel" id="new-client">');
  expect(pageHtml).not.toContain('class="slds-error"');

  const post = (body: string, sessionCookie = cookie) =>
    fetch(`${origin}/clients/`, {
      method: 'POST',
      headers: { cookie: sessionCookie, 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    });

  const invalid = await post(`name=N&slug=Not+Valid&_csrf=${encodeURIComponent(token)}`);
  expect(invalid.status).toBe(422);
  expect(invalid.headers.get('content-type')).toBe('text/html; charset=utf-8');
  expect(invalid.headers.get('content-location')).toBe('/clients/');
  const invalidHtml = await invalid.text();
  expect(invalidHtml).not.toMatch(/data-(text|if|each|attr-)|webstir-view-state/);
  expect(invalidHtml).toContain('<details class="management-panel" id="new-client" open>');
  expect(invalidHtml).toContain('value="N"');
  expect(invalidHtml).toContain('value="Not Valid"');
  expect(invalidHtml).toContain('<span class="slds-error">Use at least two characters.</span>');
  expect(invalidHtml).toContain(
    '<span class="slds-error">Use lowercase letters, numbers and dashes.</span>',
  );
  expect(invalidHtml).not.toContain('Something went wrong');
  expect(invalidHtml).toContain('<span class="client-row-name">Acme Logistics</span>');
  expect(csrfTokenFrom(invalidHtml)).toBe(token);

  const forged = await post('name=Birch&slug=birch&_csrf=forged');
  expect(forged.status).toBe(403);
  const forgedHtml = await forged.text();
  expect(forgedHtml).toContain(
    '<p class="slds-error" role="alert">Form session expired. Reload the page and try again.</p>',
  );
  expect(forgedHtml).toContain('value="Birch"');

  const created = await post(`name=Birch+%26+Co&slug=birch&_csrf=${encodeURIComponent(token)}`);
  expect(created.status).toBe(303);
  expect(created.headers.get('location')).toBe('/clients/');

  const after = await fetch(`${origin}/clients/`, {
    headers: { cookie: cookieFrom(created, cookie) },
  });
  const afterHtml = await after.text();
  expect(afterHtml).toContain('<span class="client-row-name">Birch &amp; Co</span>');
  expect(afterHtml).toContain('<details class="management-panel" id="new-client">');
  expect(afterHtml).not.toContain('class="slds-error"');
}, 60_000);

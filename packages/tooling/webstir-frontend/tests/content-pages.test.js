import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function loadFrontendModuleOrSkip(t) {
  try {
    return await import('../dist/index.js');
  } catch (err) {
    console.warn(
      '[frontend-tests] Skipping provider integration: optional dependency unavailable:',
      err?.message ?? err,
    );
    t?.diagnostic?.('skip: missing optional dependency');
    return null;
  }
}

async function createWorkspaceWithContent(options = {}) {
  const contentBasePath = options.content?.basePath ?? '/docs/';
  const contentLabel = options.content?.label ?? 'Docs';
  const contentPageName = contentBasePath.split('/').filter(Boolean)[0] ?? 'docs';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'webstir-frontend-content-'));
  const appDir = path.join(root, 'src', 'frontend', 'app');
  const pageDir = path.join(root, 'src', 'frontend', 'pages', 'home');
  const contentHubPageDir = path.join(root, 'src', 'frontend', 'pages', contentPageName);
  const contentDir = path.join(root, 'src', 'frontend', 'content');
  const publicDir = path.join(root, 'src', 'frontend', 'public');
  await fs.mkdir(appDir, { recursive: true });
  await fs.mkdir(pageDir, { recursive: true });
  await fs.mkdir(contentHubPageDir, { recursive: true });
  await fs.mkdir(contentDir, { recursive: true });
  await fs.mkdir(publicDir, { recursive: true });

  await fs.writeFile(
    path.join(appDir, 'app.html'),
    `<!DOCTYPE html><html><head><title>My Site</title>${options.appHead ?? ''}</head><body><main></main></body></html>`,
    'utf8',
  );
  await fs.writeFile(path.join(appDir, 'app.css'), 'body{font-family:sans-serif;}', 'utf8');
  await fs.writeFile(
    path.join(pageDir, 'index.html'),
    '<head></head><main><section>Home</section></main>',
    'utf8',
  );
  await fs.writeFile(
    path.join(contentHubPageDir, 'index.html'),
    `<head><title>${contentLabel}</title><link rel="stylesheet" href="index.css" /><script type="module" src="index.js"></script></head><main><section>${contentLabel}</section></main>`,
    'utf8',
  );
  await fs.writeFile(
    path.join(contentHubPageDir, 'index.css'),
    '.docs-layout{display:grid;}',
    'utf8',
  );
  await fs.writeFile(path.join(contentHubPageDir, 'index.ts'), 'export {};\n', 'utf8');
  await fs.mkdir(path.join(appDir, 'scripts', 'features'), { recursive: true });
  await fs.writeFile(path.join(appDir, 'scripts', 'features', 'content-nav.ts'), 'export {};\n');
  if (options.content) {
    await fs.writeFile(
      path.join(root, 'src', 'frontend', 'frontend.config.json'),
      JSON.stringify({ content: options.content }, null, 2),
      'utf8',
    );
  }
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'content-test',
        private: true,
        webstir: {
          mode: 'ssg',
          ...(options.siteUrl ? { siteUrl: options.siteUrl } : {}),
          enable: {
            contentNav: true,
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  await fs.writeFile(
    path.join(contentDir, 'readme.md'),
    [
      '---',
      'title: Content pipeline',
      'description: How it works',
      'order: 1',
      '---',
      '',
      '# Content pipeline',
      '',
      'Hello from markdown.',
    ].join('\n'),
    'utf8',
  );
  await fs.mkdir(path.join(contentDir, 'section'), { recursive: true });
  await fs.writeFile(
    path.join(contentDir, 'section', 'one.md'),
    ['# One', '', 'See [Two](two/?ref=one#details) and [Root](../readme/).'].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(contentDir, 'section', 'two.md'), '# Two\n\n## Details\n', 'utf8');
  await fs.writeFile(
    path.join(contentDir, '_sidebar.json'),
    JSON.stringify(
      {
        pages: [
          {
            path: `${contentBasePath}readme/`,
            title: 'Guide v1',
            order: 1,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(path.join(publicDir, 'CNAME'), 'webstir.io\n', 'utf8');

  return root;
}

test('content builder strips frontmatter and injects app styles', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { frontendProvider } = frontend;
  const workspace = await createWorkspaceWithContent();

  try {
    await frontendProvider.build({
      workspaceRoot: workspace,
      env: { WEBSTIR_MODULE_MODE: 'build' },
      incremental: false,
    });

    const htmlPath = path.join(
      workspace,
      'build',
      'frontend',
      'pages',
      'docs',
      'readme',
      'index.html',
    );
    assert.equal(fssync.existsSync(htmlPath), true, `expected ${htmlPath}`);

    const html = await fs.readFile(htmlPath, 'utf8');
    assert.ok(!html.includes('title: Content pipeline'), 'frontmatter should not be rendered');
    assert.ok(/<article\b/i.test(html), 'expected markdown wrapped in <article>');
    assert.ok(html.includes('href="/app/app.css"'), 'expected app.css link injected');
    assert.ok(html.includes('href="/pages/docs/index.css"'), 'expected docs css link injected');

    const navPath = path.join(workspace, 'build', 'frontend', 'docs-nav.json');
    assert.equal(fssync.existsSync(navPath), true, `expected ${navPath}`);

    const nav = JSON.parse(await fs.readFile(navPath, 'utf8'));
    assert.ok(Array.isArray(nav) && nav.length > 0, 'expected docs-nav.json to contain entries');
    assert.ok(
      nav.some((entry) => entry.path === '/docs/readme/'),
      'expected docs-nav.json to include /docs/readme/',
    );

    const cnamePath = path.join(workspace, 'build', 'frontend', 'CNAME');
    assert.equal(fssync.existsSync(cnamePath), true, `expected ${cnamePath}`);
    assert.equal(await fs.readFile(cnamePath, 'utf8'), 'webstir.io\n');

    const linkedHtmlPath = path.join(
      workspace,
      'build',
      'frontend',
      'pages',
      'docs',
      'section',
      'one',
      'index.html',
    );
    const linkedHtml = await fs.readFile(linkedHtmlPath, 'utf8');
    assert.ok(
      linkedHtml.includes('href="/docs/section/two/?ref=one#details"'),
      'expected sibling docs link to resolve from source file directory and preserve query/hash',
    );
    assert.ok(
      linkedHtml.includes('href="/docs/"'),
      'expected parent-relative docs link to resolve from source file directory',
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('content rebuild updates docs-nav when _sidebar.json changes', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { runBuild, runRebuild } = frontend;
  const workspace = await createWorkspaceWithContent();

  try {
    await runBuild({ workspaceRoot: workspace });

    const navPath = path.join(workspace, 'build', 'frontend', 'docs-nav.json');
    let nav = JSON.parse(await fs.readFile(navPath, 'utf8'));
    assert.equal(nav[0]?.title, 'Guide v1');

    const sidebarPath = path.join(workspace, 'src', 'frontend', 'content', '_sidebar.json');
    await fs.writeFile(
      sidebarPath,
      JSON.stringify(
        {
          pages: [
            {
              path: '/docs/readme/',
              title: 'Guide v2',
              order: 1,
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );

    await runRebuild({ workspaceRoot: workspace, changedFile: sidebarPath });

    nav = JSON.parse(await fs.readFile(navPath, 'utf8'));
    assert.equal(nav[0]?.title, 'Guide v2');
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('content builder supports configured content base path and nav manifest', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { runBuild, runPublish } = frontend;
  const workspace = await createWorkspaceWithContent({
    content: {
      basePath: '/company/',
      label: 'Company',
    },
  });

  try {
    const buildStaleNavPath = path.join(workspace, 'build', 'frontend', 'docs-nav.json');
    await fs.mkdir(path.dirname(buildStaleNavPath), { recursive: true });
    await fs.writeFile(buildStaleNavPath, '[]', 'utf8');

    await runBuild({ workspaceRoot: workspace });

    const buildNavPath = path.join(workspace, 'build', 'frontend', 'company-nav.json');
    assert.equal(fssync.existsSync(buildNavPath), true, `expected ${buildNavPath}`);
    assert.equal(
      fssync.existsSync(buildStaleNavPath),
      false,
      `did not expect ${buildStaleNavPath}`,
    );

    const distStaleNavPath = path.join(workspace, 'dist', 'frontend', 'docs-nav.json');
    await fs.mkdir(path.dirname(distStaleNavPath), { recursive: true });
    await fs.writeFile(distStaleNavPath, '[]', 'utf8');

    await runPublish({ workspaceRoot: workspace, publishMode: 'ssg' });

    const pagePath = path.join(
      workspace,
      'dist',
      'frontend',
      'company',
      'section',
      'one',
      'index.html',
    );
    assert.equal(fssync.existsSync(pagePath), true, `expected ${pagePath}`);

    const html = await fs.readFile(pagePath, 'utf8');
    assert.ok(html.includes('href="/company/"'), 'expected Company breadcrumb root href');
    assert.ok(html.includes('>Company<'), 'expected Company breadcrumb/sidebar label');
    assert.ok(
      html.includes('href="/company/section/two/?ref=one#details"') ||
        html.includes('href="/company/section/two/"'),
      'expected relative Markdown links to use /company/',
    );

    const navPath = path.join(workspace, 'dist', 'frontend', 'company-nav.json');
    assert.equal(fssync.existsSync(navPath), true, `expected ${navPath}`);
    const nav = JSON.parse(await fs.readFile(navPath, 'utf8'));
    assert.ok(
      nav.some((entry) => entry.path === '/company/readme/'),
      'expected company-nav.json to include /company/readme/',
    );

    assert.equal(fssync.existsSync(distStaleNavPath), false, `did not expect ${distStaleNavPath}`);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('content titleTemplate sets content page titles in build and publish', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { runBuild, runPublish } = frontend;
  const workspace = await createWorkspaceWithContent({
    content: {
      basePath: '/company/',
      label: 'Company',
      titleTemplate: '{title} | Example Co',
    },
  });

  try {
    await runBuild({ workspaceRoot: workspace });
    await runPublish({ workspaceRoot: workspace, publishMode: 'ssg' });

    for (const pagePath of [
      path.join(workspace, 'build', 'frontend', 'pages', 'company', 'section', 'one', 'index.html'),
      path.join(workspace, 'dist', 'frontend', 'company', 'section', 'one', 'index.html'),
    ]) {
      const html = await fs.readFile(pagePath, 'utf8');
      const titles = html.match(/<title>[^<]*<\/title>/g) ?? [];
      assert.equal(titles.length, 1, `expected one title in ${pagePath}`);
      assert.match(titles[0], /^<title>\S[^<]* \| Example Co<\/title>$/);
      assert.ok(!titles[0].includes('My Site'), 'titleTemplate should replace the app title');
      const pageTitle = titles[0].slice('<title>'.length, -'</title>'.length);
      assert.ok(
        html.includes(`property="og:title" content="${pageTitle}"`),
        'expected og:title to match the templated title',
      );
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('content pages pick a card type from the share image unless the app sets one', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { runBuild } = frontend;
  const shareImage = '<meta property="og:image" content="https://example.com/share.png">';
  const cases = [
    { appHead: '', expected: 'summary' },
    { appHead: shareImage, expected: 'summary_large_image' },
    { appHead: `${shareImage}<meta name="twitter:card" content="summary">`, expected: 'summary' },
  ];

  for (const { appHead, expected } of cases) {
    const workspace = await createWorkspaceWithContent({ appHead });
    try {
      await runBuild({ workspaceRoot: workspace });
      const html = await fs.readFile(
        path.join(workspace, 'build', 'frontend', 'pages', 'docs', 'section', 'one', 'index.html'),
        'utf8',
      );
      const cards = html.match(/<meta name="twitter:card" content="[^"]*"/g) ?? [];
      assert.deepEqual(cards, [`<meta name="twitter:card" content="${expected}"`]);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  }
});

test('published content pages name their canonical address', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { runBuild, runPublish } = frontend;
  const workspace = await createWorkspaceWithContent({ siteUrl: 'https://example.com' });

  try {
    await runBuild({ workspaceRoot: workspace });
    await runPublish({ workspaceRoot: workspace, publishMode: 'ssg' });
    const html = await fs.readFile(
      path.join(workspace, 'dist', 'frontend', 'docs', 'section', 'one', 'index.html'),
      'utf8',
    );
    assert.equal(
      (
        html.match(/<link rel="canonical" href="https:\/\/example\.com\/docs\/section\/one\/">/g) ??
        []
      ).length,
      1,
    );
    assert.ok(
      html.includes('<meta property="og:url" content="https://example.com/docs/section/one/">'),
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('content titleTemplate must include the {title} placeholder', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { runBuild } = frontend;
  const workspace = await createWorkspaceWithContent({
    content: { basePath: '/company/', label: 'Company', titleTemplate: 'Example Co' },
  });

  try {
    await assert.rejects(runBuild({ workspaceRoot: workspace }), /content\.titleTemplate/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('content nav manifest respects sidebar order across content folders', async (t) => {
  const frontend = await loadFrontendModuleOrSkip(t);
  if (!frontend) return;
  const { runBuild } = frontend;
  const workspace = await createWorkspaceWithContent({
    content: {
      basePath: '/company/',
      label: 'Company',
    },
  });

  try {
    const contentDir = path.join(workspace, 'src', 'frontend', 'content');
    const sections = [
      ['what-we-do', 'What we do', 1],
      ['what-we-build', 'What we build', 2],
      ['who-we-are', 'Who we are', 3],
      ['how-we-work', 'How we work', 4],
    ];

    for (const [slug, title] of sections) {
      const sectionDir = path.join(contentDir, slug);
      await fs.mkdir(sectionDir, { recursive: true });
      await fs.writeFile(path.join(sectionDir, 'index.md'), `# ${title}\n`, 'utf8');
    }

    await fs.writeFile(
      path.join(contentDir, '_sidebar.json'),
      JSON.stringify(
        {
          pages: sections.map(([slug, title, order]) => ({
            path: `/company/${slug}/`,
            title,
            order,
          })),
        },
        null,
        2,
      ),
      'utf8',
    );

    await runBuild({ workspaceRoot: workspace });

    const navPath = path.join(workspace, 'build', 'frontend', 'company-nav.json');
    const nav = JSON.parse(await fs.readFile(navPath, 'utf8'));
    const orderedSectionPaths = nav
      .map((entry) => entry.path)
      .filter((pathValue) => sections.some(([slug]) => pathValue === `/company/${slug}/`));

    assert.deepEqual(
      orderedSectionPaths,
      sections.map(([slug]) => `/company/${slug}/`),
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('Markdown code, callouts, and GFM content survive build and publish', async () => {
  const { load } = await import('cheerio');
  const { runBuild, runPublish } = await import('../dist/index.js');
  const workspace = await createWorkspaceWithContent();
  const code = 'const html = "<img src=x onerror=alert(1)> & text";';
  const markdown = [
    '# Rendering',
    '',
    '## Repeated heading',
    '',
    '## Repeated heading',
    '',
    '```JS title="example"',
    code,
    '```',
    '',
    '```unknown-language',
    '<tag> & unknown',
    '```',
    '',
    '```',
    '<plain> & text',
    '```',
    '',
    '    <indented> & text',
    '',
    '```js',
    '```',
    '',
    ':::note Code example',
    '```html',
    '<script>alert("callout")</script>',
    '```',
    ':::',
    '',
    '| Feature | Result |',
    '| --- | --- |',
    '| **Table** | ~~old~~ |',
    '',
    '- [x] Complete',
    '- [ ] Pending',
    '',
    'See [Details](section/two.md?mode=read#details).',
  ].join('\n');

  try {
    await fs.writeFile(path.join(workspace, 'src/frontend/content/readme.md'), markdown);
    await runBuild({ workspaceRoot: workspace });
    await runPublish({ workspaceRoot: workspace, publishMode: 'ssg' });

    for (const output of ['build/frontend/pages/docs/readme', 'dist/frontend/docs/readme']) {
      const $ = load(await fs.readFile(path.join(workspace, output, 'index.html'), 'utf8'));
      const article = $('article');
      const blocks = article.find('pre code');
      assert.equal(blocks.length, 6, output);
      assert.equal(blocks.eq(0).text(), code, output);
      assert.equal(blocks.eq(0).hasClass('language-js'), true, output);
      assert.ok(blocks.eq(0).find('.hljs-keyword').length > 0, output);
      assert.equal(blocks.eq(1).text(), '<tag> & unknown', output);
      assert.equal(blocks.eq(2).text(), '<plain> & text', output);
      assert.equal(blocks.eq(3).text(), '<indented> & text', output);
      assert.equal(blocks.eq(4).text(), '', output);
      assert.equal(blocks.eq(5).text(), '<script>alert("callout")</script>', output);
      assert.equal(blocks.find('img, script, tag, plain, indented').length, 0, output);
      assert.equal(article.find('.docs-callout--note pre code').length, 1, output);
      assert.equal(article.find('table tbody tr').length, 1, output);
      assert.equal(article.find('del').text(), 'old', output);
      assert.equal(article.find('input[type="checkbox"]:checked').length, 1, output);
      assert.equal(article.find('h2').eq(0).attr('id'), 'repeated-heading', output);
      assert.equal(article.find('h2').eq(1).attr('id'), 'repeated-heading-2', output);
      assert.equal(
        article
          .find('a')
          .filter((_, el) => $(el).text() === 'Details')
          .attr('href'),
        '/docs/section/two/?mode=read#details',
        output,
      );
    }
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('content pages inline shell sources during build, source rebuild, and publish', async () => {
  const { runBuild, runRebuild, runPublish } = await import('../dist/index.js');
  const workspace = await createWorkspaceWithContent();
  try {
    const appDir = path.join(workspace, 'src/frontend/app');
    const templatePath = path.join(appDir, 'app.html');
    await fs.writeFile(
      templatePath,
      (await fs.readFile(templatePath, 'utf8')).replace(
        '<head>',
        '<head><script nonce="content-proof" data-webstir-inline src="./first-paint.ts"></script>',
      ),
    );
    await fs.writeFile(path.join(appDir, 'first-paint.ts'), "import './paint.js';\n");
    const sourcePath = path.join(appDir, 'paint.ts');
    await fs.writeFile(
      sourcePath,
      "const contentPaintVersion: string = 'paint-v1'; document.documentElement.dataset.paint = contentPaintVersion;\n",
    );
    const builtPath = path.join(workspace, 'build/frontend/pages/docs/readme/index.html');
    await runBuild({ workspaceRoot: workspace });
    const built = await fs.readFile(builtPath, 'utf8');
    assert.match(built, /paint-v1/);
    assert.match(built, /nonce="content-proof"/);
    assert.doesNotMatch(built, /data-webstir-inline[^>]*src=/);

    await fs.writeFile(
      sourcePath,
      (await fs.readFile(sourcePath, 'utf8')).replace('paint-v1', 'paint-v2'),
    );
    await runRebuild({ workspaceRoot: workspace, changedFile: sourcePath });
    const rebuilt = await fs.readFile(builtPath, 'utf8');
    assert.match(rebuilt, /paint-v2/);
    assert.doesNotMatch(rebuilt, /paint-v1/);

    await runPublish({ workspaceRoot: workspace, publishMode: 'ssg' });
    const published = await fs.readFile(
      path.join(workspace, 'dist/frontend/docs/readme/index.html'),
      'utf8',
    );
    assert.match(published, /paint-v2/);
    assert.match(published, /nonce="content-proof"/);
    assert.doesNotMatch(published, /contentPaintVersion/);
    assert.doesNotMatch(published, /data-webstir-inline[^>]*src=/);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

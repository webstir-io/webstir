import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..', '..');

function canReadGitHistory(root: string): boolean {
  if (!existsSync(path.join(root, '.git'))) {
    return false;
  }

  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

const hasGitMetadata = canReadGitHistory(repoRoot);

const config: Config = {
  title: 'Webstir',
  tagline: 'Agentic, opinionated full-stack developer experience',
  favicon: 'img/favicon.svg',

  url: 'https://webstir.io',
  baseUrl: '/',
  organizationName: 'webstir-io',
  projectName: 'webstir',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/webstir-io/webstir/edit/main/apps/portal/',
          showLastUpdateTime: hasGitMetadata,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/logo.svg',
    navbar: {
      title: 'Webstir',
      logo: {
        alt: 'Webstir logo',
        src: 'img/webstir.svg',
      },
      items: [
        {type: 'docSidebar', sidebarId: 'tutorials', position: 'left', label: 'Tutorials'},
        {type: 'docSidebar', sidebarId: 'howTo', position: 'left', label: 'How-to'},
        {type: 'docSidebar', sidebarId: 'reference', position: 'left', label: 'Reference'},
        {type: 'docSidebar', sidebarId: 'explanations', position: 'left', label: 'Explanations'},
        {type: 'docSidebar', sidebarId: 'plans', position: 'left', label: 'Product Plans'},
        {href: 'https://github.com/webstir-io/webstir', label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/tutorials/getting-started'},
            {label: 'CLI Workflows', to: '/docs/reference/workflows'},
            {label: 'How-to Guides', to: '/docs/how-to/'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'Code of Conduct', href: 'https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md'},
            {label: 'Contributing', href: 'https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md'},
            {label: 'Support', href: 'https://github.com/webstir-io/.github/blob/main/SUPPORT.md'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: 'https://github.com/webstir-io/webstir'},
          ],
        },
      ],
      copyright: `© ${new Date().getFullYear()} Webstir.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.vsDark,
    },
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

import {useEffect} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import useBaseUrl from '@docusaurus/useBaseUrl';
import ColorModeToggle from '@theme/ColorModeToggle';
import {useColorMode} from '@docusaurus/theme-common';
import BrowserOnly from '@docusaurus/BrowserOnly';

// Icons
const Icons = {
  Rocket: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></svg>
  ),
  Terminal: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" /></svg>
  ),
  Book: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
  ),
  Layers: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
  ),
  Brain: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" /><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" /></svg>
  ),
  Code: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
  ),
  Map: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" /><line x1="9" x2="9" y1="3" y2="18" /><line x1="15" x2="15" y1="6" y2="21" /></svg>
  ),
  Cpu: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="cardIcon"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" x2="9" y1="1" y2="4" /><line x1="15" x2="15" y1="1" y2="4" /><line x1="9" x2="9" y1="20" y2="23" /><line x1="15" x2="15" y1="20" y2="23" /><line x1="20" x2="23" y1="9" y2="9" /><line x1="20" x2="23" y1="15" y2="15" /><line x1="1" x2="4" y1="9" y2="9" /><line x1="1" x2="4" y1="15" y2="15" /></svg>
  ),
};

const features = [
  {
    title: 'Agentic First',
    description: 'Built for the age of AI with context-aware workflows and automated scaffolding.',
    icon: Icons.Brain,
  },
  {
    title: 'Opinionated Stack',
    description: 'Pre-configured best practices for full-stack development. Don\'t waste time configuring.',
    icon: Icons.Layers,
  },
  {
    title: 'Single CLI',
    description: 'One tool to rule them all: build, watch, test, and publish with a unified command.',
    icon: Icons.Terminal,
  },
];

const quickLinks = [
  {
    title: 'Getting started',
    description: 'Spin up the workspace and ship your first app with the guided tutorial.',
    to: '/docs/tutorials/getting-started',
    icon: Icons.Rocket,
  },
  {
    title: 'First app',
    description: 'Walk through the full loop: init, build, watch, test, publish.',
    to: '/docs/tutorials/first-app',
    icon: Icons.Code,
  },
  {
    title: 'CLI workflows',
    description: 'Reference for build, watch, test, and publish flows in one place.',
    to: '/docs/reference/workflows',
    icon: Icons.Terminal,
  },
];

const sections = [
  {
    title: 'How-to guides',
    description: 'Task-focused recipes for day-to-day work: init projects, run the frontend watcher, validate HMR, publish artifacts, and more.',
    to: '/docs/how-to/',
    icon: Icons.Book,
  },
  {
    title: 'Reference',
    description: 'CLI commands, templates, and manifests so you can look up exact options quickly.',
    to: '/docs/reference/',
    icon: Icons.Code,
  },
  {
    title: 'Explanations',
    description: 'What the engine, pipelines, services, and dev service do under the hood.',
    to: '/docs/explanations/solution',
    icon: Icons.Cpu,
  },
  {
    title: 'Product plans',
    description: 'Roadmaps and upcoming work across backend design, generators, and infrastructure.',
    to: '/docs/product/plans',
    icon: Icons.Map,
  },
];

function HeroActions(): JSX.Element {
  const {colorMode, setColorMode} = useColorMode();

  return (
    <div className="heroActions">
      <a
        className="heroActionLink"
        href="https://github.com/webstir-io"
        rel="noopener noreferrer"
        target="_blank"
      >
        GitHub
        <svg
          className="heroActionIcon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </a>
      <ColorModeToggle
        className="heroColorToggle"
        value={colorMode}
        onChange={() => setColorMode(colorMode === 'dark' ? 'light' : 'dark')}
      />
    </div>
  );
}

export default function Home(): JSX.Element {
  const logoUrl = useBaseUrl('/img/webstir.svg');

  useEffect(() => {
    const className = 'home-no-nav-links';
    document.documentElement.classList.add(className);
    document.body.classList.add(className);
    const root = document.getElementById('__docusaurus');
    root?.classList.add(className);

    return () => {
      document.documentElement.classList.remove(className);
      document.body.classList.remove(className);
      root?.classList.remove(className);
    };
  }, []);

  return (
    <Layout
      title="Webstir Portal"
      description="Documentation for the Webstir full-stack developer experience"
    >
      <header className={clsx('heroBanner')}>
        <BrowserOnly fallback={null}>
          {() => <HeroActions />}
        </BrowserOnly>
        <div className="container">
          <div className="heroLogo">
            <img src={logoUrl} alt="Webstir" />
          </div>
          <div className="pill">Full-stack, agent-first workflow</div>
          <h1>Build with Webstir</h1>
          <p>
            Opinionated architecture, pluggable providers, and a single CLI that keeps build,
            watch, test, and publish flows consistent. Start fast, stay fast.
          </p>
          <div className="heroButtons">
            <Link className="button button--secondary button--lg" to="/docs/tutorials/getting-started">
              Start the tutorial
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/reference/cli">
              View CLI reference
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Features Section */}
        <section className="section featureSection">
          <div className="container">
            <div className="features">
              {features.map((props, idx) => (
                <div key={idx} className="feature">
                  <div className="featureIcon">
                    <props.icon />
                  </div>
                  <h3>{props.title}</h3>
                  <p>{props.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>Jump in</h2>
            <div className="cards">
              {quickLinks.map((item) => (
                <Link key={item.title} to={item.to} className="card">
                  <div className="cardHeader">
                    <item.icon />
                    <h3>{item.title}</h3>
                  </div>
                  <p>{item.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="container">
            <h2>Everything you need</h2>
            <div className="cards">
              {sections.map((item) => (
                <Link key={item.title} to={item.to} className="card">
                  <div className="cardHeader">
                    <item.icon />
                    <h3>{item.title}</h3>
                  </div>
                  <p>{item.description}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}

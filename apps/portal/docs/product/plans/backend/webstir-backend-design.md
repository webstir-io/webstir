# Webstir Backend Design

### Core Server
- Choose default server framework (Fastify) and baseline plugins
- Initialize server: pino logging, CORS, helmet, rate limiting, body limits
- Enforce security headers and output serialization safeguards
- Configure CORS policies with explicit origins and methods
- Configure rate limits and request size limits per route/module
- Implement ErrorHandler: normalized error mapping and structured logging with requestId
- Add health/readiness endpoints and basic metrics

### Module System
- Implement ModuleLoader: discover modules via package.json, import, validate manifest
- Ensure backend provider emits ModuleManifest using shared contract (derive defaults, validate workspace overrides) — now handled in `@webstir-io/module-contract`; focus future work on wiring routes/views/jobs via the shared helpers instead of redefining contexts
- Implement Router: register module RouteSpecs with validation and ts-rest adapter
- Implement ContextBuilder: assemble RequestContext per request (auth, db, env, logger)
- Optional static asset serving behind provider flag
- Implement SSR seam: SvelteKit adapter (in-process mount or HTTP client mode)

### Providers & Integrations
- Integrate DatabaseProvider: connection pooling, migrations, transaction wrapper
- Integrate AuthProvider: cookie/session handling, csrf protection hooks for mutations
- Provide testing harness via TestingProvider: fixtures loading, e2e route tests
- Emit typed client from contracts into packages/client for consumers

### Developer Experience
- Add configuration loading: dotenv, env schema validation, defaults
- Set up pnpm workspace layout (packages, providers, examples) and scripts
- Build CLI commands (webstir dev/start/build) to select providers and boot services
- Enable hot-reload for modules and config in dev
- Add logging/tracing: correlation headers, request timing, minimal metrics
- Add CI tasks: typecheck, lint, tests, build, and publish client artifacts as needed

### Versioning & Examples
- Add API versioning and deprecation headers support
- Wire example accounts module and verify /accounts route is served

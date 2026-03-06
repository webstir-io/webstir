# webstir add-route / add-job requirements

## Goal
- Provide a clear reference for the CLI scaffolding commands before taking on further changes.
- Capture file outputs, manifest mutations, validation rules, and test coverage so future edits stay compatible.

## Out of Scope
- Changing existing templates or manifest schema (tracked in module-contract).
- Introducing new scaffolding targets beyond Fastify routes and TypeScript jobs.
- Refactoring worker orchestration or project discovery.

## CLI Surface
- `webstir add-route <name> [--method <METHOD>] [--path <path>] [--fastify] [--project <project>]`
  - Defined in `orchestrators/dotnet/CLI/Help.cs:161`; wired via DI in `orchestrators/dotnet/CLI/Program.cs:62`.
  - `--method` defaults to `GET` and must be one of `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS` (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:17`).
  - `--path` defaults to `/api/<name>` and gets a leading `/` when omitted (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:45`).
  - `--fastify` scaffolds a handler file and patches `server/fastify.ts` if present (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:52`).
- `webstir add-job <name> [--schedule <expression>] [--project <project>]`
  - Defined in `orchestrators/dotnet/CLI/Help.cs:177`; workflow lives in `orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:18`.
  - `--schedule` stores an arbitrary cron-like string in the manifest (`orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:71`).
- Multi-project detection is centralized in `orchestrators/dotnet/Engine/Workflows/BaseWorkflow.cs:43` so both commands honor `--project`.

## Manifest Mutations
- Target: `<workspace>/<project>/package.json` (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:87`, `orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:63`).
- Routes: append `{ name, method, path }` unless an entry already exists with the same method+path (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:101`).
- Jobs: append `{ name, schedule? }` unless an entry with the same name already exists (`orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:75`).
- Shape aligns with `packages/contracts/module-contract/schema/module-manifest.schema.json:44` and `packages/contracts/module-contract/src/index.ts:360`.
- Potential metadata extensions:
  - Route shape supports `summary`, `description`, `tags`, `input` (params/query/body/headers), and `output` schemas that generators could pre-seed.
  - Job shape supports `description` and `priority` in addition to `name`/`schedule`.

### Metadata capture approach (implemented)
- CLI remains script-friendly (no interactive prompts) and continues to rely on positional args/flags only (`orchestrators/dotnet/Engine/Workflows/BaseWorkflow.cs:17`).
- Optional metadata flags now populate manifest fields without affecting existing flows.
- `orchestrators/dotnet/CLI/Help.cs:161` lists the new flags; workflows in `Engine/Workflows/AddRouteWorkflow.cs` and `Engine/Workflows/AddJobWorkflow.cs` parse, normalize, and persist them.
- Tests in `orchestrators/dotnet/Tester/Workflows/Add/AddWorkflowTests.cs` assert manifest outputs for metadata scenarios.

#### Flag set
- Routes
  - `--summary <text>` — short human-readable summary → manifest `summary`.
  - `--description <text>` — optional longer description → manifest `description`.
  - `--tags tag1,tag2` — comma-separated values trimmed/deduped (stable order) → manifest `tags` array.
  - `--params-schema`, `--query-schema`, `--body-schema`, `--headers-schema` — schema references for request slots (`kind:name@source`).
  - `--response-schema`, `--response-status`, `--response-headers-schema` — describe response body, status, and headers.
- Jobs
  - `--description <text>` — manifest `description`.
  - `--priority <number|string>` — manifest `priority` (pass-through, validate numeric when parsable).

#### Implementation notes
- Tag parsing trims inputs, removes duplicates case-insensitively, and preserves encounter order.
- Priority accepts integers (stored numerically) or fallback strings when non-numeric.
- Schema flags use `kind:name@source` syntax (kind defaults to `zod`; `source` optional) and populate manifest `input`/`output` references.

- Schema references follow module-contract expectations (`kind`, `name`, optional `source`). CLI accepts `kind:name@source`, defaulting `kind` to `zod` and omitting `source` when unspecified. Invalid kinds or missing names raise `ArgumentException`.

## Generated Files
- Routes (`--fastify` only)
  - `src/backend/server/routes/<name>.ts` created with a Fastify `register` wrapper (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:122`).
  - `src/backend/server/fastify.ts` import + registration patch inserted after Fastify bootstrap or health endpoint (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:156`).
  - No files touched when `--fastify` is omitted.
- Jobs
  - `src/backend/jobs/<name>/index.ts` with a `run()` export, main guard, and console logging (`orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:36`).
  - Existing job directory causes a hard error before writing (`orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:30`).

## Console Output & Errors
- Successful route: `Added route METHOD /path ...` (includes Fastify note when applicable) (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:59`).
- Successful job: `Created backend job ...` with relative path (`orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:53`).
- Guardrails:
  - Missing positional `<name>` throws usage errors (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:21`, `orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:20`).
  - Invalid HTTP method raises `ArgumentException` with allowed list (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:40`).
  - Invalid job schedules (bad field counts, unsupported macros, illegal characters) trigger immediate errors (`orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:138`).
  - Missing `package.json` or job directory conflicts surface explicit messages (`orchestrators/dotnet/Engine/Workflows/AddRouteWorkflow.cs:90`, `orchestrators/dotnet/Engine/Workflows/AddJobWorkflow.cs:30`).
  - Multi-project ambiguity handled centrally with actionable guidance (`orchestrators/dotnet/Engine/Workflows/BaseWorkflow.cs:63`).

## Tests & Validation
- Focused coverage in `orchestrators/dotnet/Tester/Workflows/Add/AddWorkflowTests.cs`
  - Manifest writes for baseline commands (`orchestrators/dotnet/Tester/Workflows/Add/AddWorkflowTests.cs:245`).
  - Metadata flags for jobs (`orchestrators/dotnet/Tester/Workflows/Add/AddWorkflowTests.cs:177`).
  - Metadata flags for routes (`orchestrators/dotnet/Tester/Workflows/Add/AddWorkflowTests.cs:358`).
  - Fastify scaffolding and import patching (`orchestrators/dotnet/Tester/Workflows/Add/AddWorkflowTests.cs:245`).
  - Help output (now includes metadata flags) (`orchestrators/dotnet/Tester/Workflows/Add/AddWorkflowTests.cs:294`).
- When iterating, run `dotnet test Tester/Tester.csproj --filter FullyQualifiedName~AddWorkflowTests`.

## Open Questions / Follow-ups
- Should route scaffolding support other backends (Express, Hono) or is Fastify the only first-party option?
- Sequence schema flag implementation once module-contract exposes helpers.
- Document org-wide schema naming/source conventions so CLI help can link to authoritative guidance. ✅ Done — see `packages/contracts/module-contract/README.md#schema-references` and the CLI reference links.

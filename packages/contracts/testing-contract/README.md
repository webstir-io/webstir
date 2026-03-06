# @webstir-io/testing-contract

TypeScript types and JSON schema defining Webstir’s test manifests, runner events, and summaries. Downstream tooling (CLI, dashboards, custom reporters) consume this package to stay aligned with the official testing contract.

## Status

- Experimental testing contract for the Webstir ecosystem — event and manifest schemas may evolve alongside the runner and host.
- Use pinned versions and expect breaking changes while the testing story stabilizes.

## Install

```bash
npm install @webstir-io/testing-contract
```

## Exported Types

```ts
import type {
  TestRuntime,
  TestModule,
  TestManifest,
  TestRunResult,
  RunnerSummary,
  RunnerStartEvent,
  RunnerResultEvent,
  RunnerSummaryEvent,
  RunnerLogEvent,
  RunnerErrorEvent,
  RunnerWatchIterationEvent,
  RunnerEvent,
} from '@webstir-io/testing-contract';
```

- `TestManifest` documents discovered tests (workspace root, timestamp, modules).
- `RunnerEvent` unions all structured events emitted by `@webstir-io/webstir-testing`.
- `RunnerSummary` aggregates totals and individual `TestRunResult`s.

Schema artifacts are published under `schema/`:

- `TestManifest.schema.json`
- `RunnerEvent.schema.json`

The schemas are also hosted at `https://webstir.dev/schema/testing-contract/*.json` for tooling that prefers remote references.

## Usage Examples

### Handling Runner Events

```ts
import type { RunnerEvent } from '@webstir-io/testing-contract';

function onEvent(payload: string) {
  const event = JSON.parse(payload) as RunnerEvent;
  if (event.type === 'summary') {
    console.log(`${event.runtime} passed ${event.summary.passed}`);
  }
}
```

### Validating With JSON Schema

```ts
import Ajv from 'ajv';
import schema from '@webstir-io/testing-contract/schema/RunnerEvent.schema.json';

const ajv = new Ajv();
const validate = ajv.compile(schema);

function assertEvent(payload: string) {
  const event = JSON.parse(payload);
  if (!validate(event)) {
    throw new Error(`Invalid runner event: ${ajv.errorsText(validate.errors)}`);
  }
}
```

## Community & Support

- Code of Conduct: https://github.com/webstir-io/.github/blob/main/CODE_OF_CONDUCT.md
- Contributing guidelines: https://github.com/webstir-io/.github/blob/main/CONTRIBUTING.md
- Security policy and disclosure process: https://github.com/webstir-io/.github/blob/main/SECURITY.md
- Support expectations and contact channels: https://github.com/webstir-io/.github/blob/main/SUPPORT.md

## Maintainer Workflow

```bash
npm install
npm run clean          # remove dist artifacts
npm run build          # emits dist/index.js, dist/index.d.ts, refreshed schema/
npm run test
npm run smoke
# Release helper (bumps version, pushes tags to trigger release workflow)
npm run release -- patch
```

- Regenerate schema files whenever TypeScript interfaces change.
- Ensure CI runs `npm ci`, `npm run clean`, `npm run build`, `npm run test`, and `npm run smoke` before publishing.
- Publishing targets npm and is triggered by the release workflow.

## License

MIT © Webstir

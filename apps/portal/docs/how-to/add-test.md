# Add Test

Scaffold a new `.test.ts` in the nearest `tests/` folder so it runs with the `test` workflow.

## Purpose
- Create a test quickly in the right location.
- Keep tests organized alongside the code under test.

## When To Use
- Adding coverage for a feature, workflow, or contract.

## CLI
- `webstir-bun add-test <name-or-path> --workspace <path>`
- In this repo: `bun run orchestrate:bun -- add-test <name-or-path> --workspace "$PWD/<workspace>"`

## Inputs
- `<name-or-path>`: file name or relative path. The workflow resolves the closest `tests/` folder from the provided context.

## Steps
1. Resolve the target `tests/` folder from the provided path.
2. Delegate to the canonical `@webstir-io/webstir-testing` scaffold helper.
3. Write the template if it does not already exist.

## Outputs
- New test file: `<resolved-tests-folder>/<name>.test.ts`.

## Errors & Exit Codes
- Non-zero if the path is invalid, the file exists, or file IO fails.

## Related Docs
- Workflows — [workflows](../reference/workflows.md)
- CLI — [cli](../reference/cli.md)
- Test — [test](test.md)
- Tests — [tests](../explanations/testing.md)

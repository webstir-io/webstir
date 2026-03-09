# webstir

Bun-first CLI for Webstir.

Primary command name: `webstir`

Current command surface:

- `init`
- `refresh`
- `repair`
- `enable`
- `add-page`
- `add-test`
- `add-route`
- `add-job`
- `backend-inspect`
- `build`
- `publish`
- `watch`
- `test`
- `smoke`

Repo-local use:

```bash
bun run webstir -- --help
bun run webstir -- build --workspace /absolute/path/to/workspace
```

Local machine install for external workspaces:

```bash
cd /Users/iamce/dev/webstir-io/webstir/orchestrators/bun
bun link

mkdir -p ~/tmp/webstir-check
cd ~/tmp/webstir-check
bun link @webstir-io/webstir

./node_modules/.bin/webstir init ssg site
cd site
bun install
../node_modules/.bin/webstir build --workspace "$PWD"
```

For a tarball install, pack the CLI locally with:

```bash
cd /Users/iamce/dev/webstir-io/webstir/orchestrators/bun
bun run pack:local
```

For a machine-local standalone tarball that bundles the current Webstir packages:

```bash
cd /Users/iamce/dev/webstir-io/webstir/orchestrators/bun
bun run pack:standalone

mkdir -p ~/tmp/webstir-standalone
cd ~/tmp/webstir-standalone
printf '{"name":"webstir-local","private":true}\n' > package.json
bun add /Users/iamce/dev/webstir-io/webstir/orchestrators/bun/artifacts/webstir-io-webstir-0.1.0-standalone.tgz

./node_modules/.bin/webstir init ssg site
cd site
bun install
../node_modules/.bin/webstir build --workspace "$PWD"
```

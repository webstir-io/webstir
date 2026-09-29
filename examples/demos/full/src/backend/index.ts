import { createDefaultBunBackendBootstrap, startBunBackend } from '@webstir-io/webstir-backend';

await startBunBackend(createDefaultBunBackendBootstrap({ importMetaUrl: import.meta.url }));

import { prepareApp } from '@webstir-io/webstir-backend';

import { loadProvider } from './providers.ts';
import { assertNoProviderErrorDiagnostics } from './provider-diagnostics.ts';
import { createWorkspaceRuntimeEnv } from './runtime.ts';
import { readWorkspaceDescriptor } from './workspace.ts';

/**
 * Builds an app's backend for a command that works on its data, such as `migrate` or `jobs`, and
 * points the batteries at the app.
 */
export async function buildBackendForCommand(
  workspaceRoot: string,
  command: string,
): Promise<void> {
  const workspace = await readWorkspaceDescriptor(workspaceRoot);
  if (!workspace.layers.server) {
    throw new Error(
      `${command} needs an app with a server (src/backend/index.ts), and ${workspace.name} has none.`,
    );
  }
  const provider = await loadProvider('backend');
  const result = await provider.build({
    workspaceRoot: workspace.root,
    env: createWorkspaceRuntimeEnv(workspace.root, 'build'),
    incremental: false,
  });
  assertNoProviderErrorDiagnostics('backend', 'build', result);
  prepareApp(workspace.root);
}

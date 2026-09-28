import path from 'node:path';

export async function validateRenderTemplates(workspaceRoot: string): Promise<void> {
  const { validateRenderPrograms } = await import('@webstir-io/webstir-frontend');
  await validateRenderPrograms({
    workspaceRoot,
    pagesRoot: path.join(workspaceRoot, 'build', 'frontend', 'pages'),
  });
}

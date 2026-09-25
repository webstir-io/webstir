import path from 'node:path';

export async function validateRenderTemplates(workspaceRoot: string): Promise<void> {
  const { validateRenderPrograms } = await import('@webstir-io/webstir-frontend');
  await validateRenderPrograms({
    workspaceRoot,
    pagesRoot: path.join(workspaceRoot, 'build', 'frontend', 'pages'),
  });
}

/** SPA templates cannot have bindings; see the frontend's checkSpaTemplates. */
export async function checkSpaTemplates(workspaceRoot: string): Promise<void> {
  const { checkSpaTemplates: check } = await import('@webstir-io/webstir-frontend');
  await check(workspaceRoot);
}

import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const targets = [
  'apps/portal',
  'examples/demos/full',
  'examples/demos/auth-crud',
  'examples/demos/dashboard',
  'examples/demos/ssg/site',
  'orchestrators/bun/resources/templates/full',
];
for (const target of targets) {
  for (const name of ['client_nav', 'document_navigation', 'form_enhancement']) {
    await copyFile(
      path.join(root, `orchestrators/bun/resources/features/client_nav/${name}.ts`),
      path.join(root, target, `src/frontend/app/scripts/features/${name.replaceAll('_', '-')}.ts`),
    );
  }
}

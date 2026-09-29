// Scaffolds wrote Errors.404.html, Errors.500.html and Errors.default.html at the app's root, and
// nothing ever read them: an app's 404 page is src/frontend/pages/404. Repair removes a copy only
// when it is byte-for-byte the one Webstir shipped, and leaves any other with a note.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

// SHA-256 (with LF line endings) of each page as every scaffold wrote it.
const SHIPPED: Readonly<Record<string, string>> = {
  'Errors.404.html': '9346cae0a0e2bb5a2034c2f9b995c73aa85b0de34a0b596d914a47b4e85a5aaf',
  'Errors.500.html': '85363740cdd1a802e6d6a666007d134e68f156d97ef13f045cf08528ab1db638',
  'Errors.default.html': '7ae2fc5ef3a191fa09986cc2f46fccebf2e37d072dc05a123447c098be641fb6',
};

export const ERROR_PAGE_FILES = Object.keys(SHIPPED);

export async function retireErrorPageCopies(
  workspaceRoot: string,
  changes: string[],
  notes: string[],
  dryRun: boolean,
): Promise<void> {
  for (const name of ERROR_PAGE_FILES) {
    const file = path.join(workspaceRoot, name);
    if (!existsSync(file)) continue;
    const source = (await Bun.file(file).text()).replace(/\r\n/g, '\n');
    if (createHash('sha256').update(source).digest('hex') === SHIPPED[name]) {
      if (!dryRun) await rm(file);
      changes.push(name);
    } else {
      notes.push(
        `${name} is not used: Webstir never read it. An app's error page is src/frontend/pages/404; delete ${name} once nothing you changed in it is needed.`,
      );
    }
  }
}

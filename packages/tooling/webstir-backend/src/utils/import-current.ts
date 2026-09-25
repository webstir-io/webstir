import { realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Imports a module as it is now, not as an earlier import cached it. Bun keeps ES modules in
 * `require.cache` and ignores a query string; Node does the opposite.
 */
export async function importCurrent(fullPath: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(fullPath).href;
  if (!('Bun' in globalThis)) {
    return (await import(`${url}?t=${Date.now()}`)) as Record<string, unknown>;
  }
  const keys = new Set([fullPath]);
  try {
    keys.add(await realpath(fullPath));
  } catch {
    // A missing file fails the import below with its own error.
  }
  for (const key of keys) {
    delete require.cache[key];
  }
  return (await import(url)) as Record<string, unknown>;
}

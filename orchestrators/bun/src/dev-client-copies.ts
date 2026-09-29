// Webstir serves its own live-update and reload clients in development. The copies of them that
// earlier scaffolds wrote into src/frontend/app are no longer used; repair removes a copy only when
// it is byte-for-byte one Webstir shipped, and points out any other.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

// SHA-256 (with LF line endings) of every hmr.js and refresh.js a scaffold has written.
const SHIPPED: Readonly<Record<string, ReadonlySet<string>>> = {
  'hmr.js': new Set([
    '135e2745a1a60c8c231b8b09dd0fb19c8369a477de433ea62814d3d96054a5f9',
    '55393508b9a4f0e26b41d43cb750a9ada581d4604228dda22725dbc5a7310d1b',
    '675a4f7c54f04cbf59023adb730800c398d58d48f2ce4ff417d79c7c698d39b2',
    '79c3d9d93a5eb5b1033568ea738fdca20d6bef81687309de3e6488950492a4a3',
    '95389ea63898e0058a63ab9edf75e81eba54ef0da0ecf5366ef96adb00cecac7',
    'a081b7640499da3ebf9d80035b85852cc33434c81bd6b164b54a171f51ad48c5',
    'da32a377961351ebde2c4cbf92279090c39a765dce89e88019441b7e8bd49fd4',
  ]),
  'refresh.js': new Set([
    '26293df940b5d141d99a7f7b3a62b9eae8967da352426d2d8545ccf3f9fff735',
    '2a1ea6f11be71e2450446a2dcc3d2f5c459ea0301be4b86fdc33a29495f8a24f',
    '3de478aa68c5a300ece044d6fa2f32c9680bb96de7575fc271f3f8c2cf1227c5',
    '743df5c1914e08b5b1b4081702c3e089c43ab85303820fd099d9d27bfe0432b7',
    'e10d84ef4f7c864c51676d0d1ab5ba0968fa0cf5a8f29e75ca6db8f22f2fe722',
    'e7070f09dd155a229ee41991295d00a87dd6ffa714334cfb6b741cef2f8d8040',
  ]),
};

export const DEV_CLIENT_FILES = Object.keys(SHIPPED);

export function isShippedDevClient(name: string, source: string): boolean {
  const hash = createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
  return SHIPPED[name]?.has(hash) ?? false;
}

/** Removes the app's shipped copies of the dev clients, and notes any it changed. */
export async function retireDevClientCopies(
  workspaceRoot: string,
  changes: string[],
  notes: string[],
  dryRun: boolean,
): Promise<void> {
  for (const name of DEV_CLIENT_FILES) {
    const file = path.join(workspaceRoot, 'src', 'frontend', 'app', name);
    if (!existsSync(file)) continue;
    const relative = path.relative(workspaceRoot, file).split(path.sep).join('/');
    if (isShippedDevClient(name, await Bun.file(file).text())) {
      if (!dryRun) await rm(file);
      changes.push(relative);
    } else {
      notes.push(
        `${relative} is no longer used: Webstir serves its own /${name} in development. Delete it once nothing you changed in it is needed.`,
      );
    }
  }
}

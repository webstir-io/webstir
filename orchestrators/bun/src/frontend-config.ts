import path from 'node:path';
import { existsSync } from 'node:fs';

export interface FrontendConfigDocument {
  readonly filePath: string;
  readonly source: string | null;
  readonly root: Record<string, unknown>;
}

export async function readFrontendConfigDocument(
  workspaceRoot: string,
): Promise<FrontendConfigDocument> {
  const filePath = path.join(workspaceRoot, 'src', 'frontend', 'frontend.config.json');
  if (!existsSync(filePath)) {
    return {
      filePath,
      source: null,
      root: {},
    };
  }

  const source = await Bun.file(filePath).text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Frontend config at ${filePath} is not valid JSON.`, { cause: error });
  }

  if (!isRecord(parsed)) {
    throw new Error(`Frontend config at ${filePath} must contain a JSON object.`);
  }

  return {
    filePath,
    source,
    root: parsed,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

#!/usr/bin/env bun
import path from 'node:path';
import { runAddTest } from './add.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspaceIndex = args.findIndex((arg) => arg === '--workspace' || arg === '-w');
  if (workspaceIndex < 0 || workspaceIndex + 1 >= args.length) {
    throw new Error('Missing required --workspace <path> option.');
  }

  const workspaceRoot = path.resolve(args[workspaceIndex + 1]);
  const nameArg = args.find((arg, index) => index !== workspaceIndex && index !== workspaceIndex + 1 && !arg.startsWith('-'));

  if (!nameArg) {
    throw new Error('Missing test name. Usage: webstir-testing-add <name> --workspace <path>');
  }

  const result = await runAddTest({
    workspaceRoot,
    name: nameArg,
  });

  if (!result.created) {
    console.log(`File already exists: ${result.relativePath}`);
    return;
  }

  console.log(`Created ${result.relativePath}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

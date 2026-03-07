import type { CommandExecutionResult } from './types.ts';
import { runCommand, type RunCommandOptions } from './execute.ts';

export type RunPublishOptions = RunCommandOptions;

export async function runPublish(options: RunPublishOptions): Promise<CommandExecutionResult> {
  return await runCommand('publish', options);
}

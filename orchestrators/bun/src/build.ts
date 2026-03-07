import type {
  CommandExecutionResult,
} from './types.ts';
import { runCommand, type RunCommandOptions } from './execute.ts';

export type RunBuildOptions = RunCommandOptions;

export async function runBuild(options: RunBuildOptions): Promise<CommandExecutionResult> {
  return await runCommand('build', options);
}

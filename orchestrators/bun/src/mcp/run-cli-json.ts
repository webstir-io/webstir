import { runCli } from '../cli.ts';

interface CliStream {
  write(message: string): void;
}

interface CliIo {
  readonly stdout: CliStream;
  readonly stderr: CliStream;
}

export interface JsonCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly data?: Record<string, unknown>;
}

export async function runCliJson(args: readonly string[]): Promise<JsonCliResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    stdout: {
      write(message) {
        stdout.push(message);
      },
    },
    stderr: {
      write(message) {
        stderr.push(message);
      },
    },
  };

  const exitCode = await runCli(args, io);
  const stdoutText = stdout.join('');
  const stderrText = stderr.join('');
  const trimmed = stdoutText.trim();

  return {
    exitCode,
    stdout: stdoutText,
    stderr: stderrText,
    ...(trimmed.length > 0 ? { data: JSON.parse(trimmed) as Record<string, unknown> } : {}),
  };
}

import { appUrl } from '../app/env.js';
import { emailSetupProblem } from '../email/index.js';
import type { SignInOptions } from './module.js';

/** What sign-in still needs in production, named: APP_URL, and whatever each way in needs. */
export function signInSetupProblem(options: SignInOptions): string | undefined {
  try {
    appUrl();
  } catch (error) {
    return (error as Error).message;
  }
  if (options.emailCode !== false) {
    const email = emailSetupProblem();
    if (email) return `sign-in sends codes by email, but ${email}`;
  }
  for (const provider of options.providers ?? []) {
    const problem = provider.setupProblem?.();
    if (problem) return `sign-in with ${provider.label} is not set up: ${problem}`;
  }
  return undefined;
}

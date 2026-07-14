import path from 'node:path';
import { mkdir, mkdtemp, readdir, rename, rm, rmdir } from 'node:fs/promises';

interface RefreshTransaction<T> {
  readonly parentRoot: string;
  readonly previousWorkspaceRoot: string;
  readonly replacementWorkspaceRoot: string;
  readonly value: T;
}

export interface ReplaceRefreshWorkspaceOptions<T> {
  readonly workspaceRoot: string;
  readonly prepareReplacement: (replacementWorkspaceRoot: string) => Promise<T>;
  readonly verifyIsolatedWorkspace: (isolatedWorkspaceRoot: string) => Promise<void>;
}

export async function replaceRefreshWorkspace<T>(
  options: ReplaceRefreshWorkspaceOptions<T>,
): Promise<T> {
  const transaction = await prepareRefreshTransaction(options);
  await isolateRefreshWorkspace(
    options.workspaceRoot,
    transaction,
    options.verifyIsolatedWorkspace,
  );
  await promoteRefreshReplacement(options.workspaceRoot, transaction);
  await removePreviousWorkspace(transaction, options.verifyIsolatedWorkspace);
  return transaction.value;
}

async function prepareRefreshTransaction<T>(
  options: ReplaceRefreshWorkspaceOptions<T>,
): Promise<RefreshTransaction<T>> {
  const parentRoot = await mkdtemp(
    path.join(path.dirname(options.workspaceRoot), '.webstir-refresh-'),
  );
  const previousWorkspaceRoot = path.join(parentRoot, 'workspace');
  const replacementWorkspaceRoot = path.join(parentRoot, 'replacement');

  try {
    const value = await options.prepareReplacement(replacementWorkspaceRoot);
    return {
      parentRoot,
      previousWorkspaceRoot,
      replacementWorkspaceRoot,
      value,
    };
  } catch (error) {
    return await discardPreparedRefresh(parentRoot, options.workspaceRoot, error);
  }
}

async function discardPreparedRefresh(
  parentRoot: string,
  workspaceRoot: string,
  originalError: unknown,
): Promise<never> {
  try {
    await rm(parentRoot, { recursive: true, force: true });
  } catch (cleanupError) {
    throw new Error(
      `Refresh preparation failed. The original workspace is unchanged at ${workspaceRoot}, but staging cleanup failed at ${parentRoot}.`,
      { cause: new AggregateError([originalError, cleanupError]) },
    );
  }

  throw originalError;
}

async function isolateRefreshWorkspace<T>(
  workspaceRoot: string,
  transaction: RefreshTransaction<T>,
  verifyIsolatedWorkspace: (isolatedWorkspaceRoot: string) => Promise<void>,
): Promise<void> {
  try {
    await rename(workspaceRoot, transaction.previousWorkspaceRoot);
  } catch (error) {
    await discardPreparedRefresh(
      transaction.parentRoot,
      workspaceRoot,
      new Error(`Unable to isolate the workspace before refresh: ${workspaceRoot}`, {
        cause: error,
      }),
    );
  }

  try {
    await verifyIsolatedWorkspace(transaction.previousWorkspaceRoot);
  } catch (error) {
    throw new Error(
      `Refresh stopped because the target changed while it was being isolated. The original remains at ${transaction.previousWorkspaceRoot}, and the prepared replacement remains at ${transaction.replacementWorkspaceRoot}.`,
      { cause: error },
    );
  }
}

async function promoteRefreshReplacement<T>(
  workspaceRoot: string,
  transaction: RefreshTransaction<T>,
): Promise<void> {
  try {
    await mkdir(workspaceRoot);
  } catch (error) {
    throw new Error(
      `Refresh could not install the prepared replacement because ${workspaceRoot} is no longer available. The original remains at ${transaction.previousWorkspaceRoot}, and the prepared replacement remains at ${transaction.replacementWorkspaceRoot}.`,
      { cause: error },
    );
  }

  try {
    const entries = await readdir(transaction.replacementWorkspaceRoot);
    for (const entry of entries) {
      await rename(
        path.join(transaction.replacementWorkspaceRoot, entry),
        path.join(workspaceRoot, entry),
      );
    }
    await rmdir(transaction.replacementWorkspaceRoot);
  } catch (error) {
    throw new Error(
      `Refresh reserved ${workspaceRoot}, but could not fully populate it. The original remains at ${transaction.previousWorkspaceRoot}, and uninstalled replacement files remain at ${transaction.replacementWorkspaceRoot}.`,
      { cause: error },
    );
  }
}

async function removePreviousWorkspace<T>(
  transaction: RefreshTransaction<T>,
  verifyIsolatedWorkspace: (isolatedWorkspaceRoot: string) => Promise<void>,
): Promise<void> {
  try {
    await verifyIsolatedWorkspace(transaction.previousWorkspaceRoot);
  } catch (error) {
    throw new Error(
      `Refresh installed the replacement, but the previous workspace changed before cleanup and remains at ${transaction.previousWorkspaceRoot}.`,
      { cause: error },
    );
  }

  try {
    await rm(transaction.parentRoot, { recursive: true, force: true });
  } catch (error) {
    throw new Error(
      `Refresh installed the replacement, but the previous workspace could not be fully removed from ${transaction.parentRoot}.`,
      { cause: error },
    );
  }
}

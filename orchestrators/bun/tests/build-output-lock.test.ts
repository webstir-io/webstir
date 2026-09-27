import { expect, test } from 'bun:test';

import { createBuildOutputLock } from '../src/build-output-lock.ts';

interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

function createGate(): Gate {
  let open = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

type Step = { readonly kind: 'read' | 'write'; readonly name: string };

const cases: ReadonlyArray<{
  readonly title: string;
  readonly steps: readonly Step[];
  /** Tasks running once every step has been requested and none has finished. */
  readonly runningAtOnce: readonly string[];
  /** The order the tasks start in as each running task finishes in turn. */
  readonly startOrder: readonly string[];
}> = [
  {
    title: 'reads run together',
    steps: [
      { kind: 'read', name: 'r1' },
      { kind: 'read', name: 'r2' },
    ],
    runningAtOnce: ['r1', 'r2'],
    startOrder: ['r1', 'r2'],
  },
  {
    title: 'a build waits for the reads in flight',
    steps: [
      { kind: 'read', name: 'r1' },
      { kind: 'write', name: 'w1' },
    ],
    runningAtOnce: ['r1'],
    startOrder: ['r1', 'w1'],
  },
  {
    title: 'a read waits for the build that is running',
    steps: [
      { kind: 'write', name: 'w1' },
      { kind: 'read', name: 'r1' },
    ],
    runningAtOnce: ['w1'],
    startOrder: ['w1', 'r1'],
  },
  {
    title: 'a read that arrives while a build waits starts after that build',
    steps: [
      { kind: 'read', name: 'r1' },
      { kind: 'write', name: 'w1' },
      { kind: 'read', name: 'r2' },
    ],
    runningAtOnce: ['r1'],
    startOrder: ['r1', 'w1', 'r2'],
  },
  {
    title: 'builds run one at a time',
    steps: [
      { kind: 'write', name: 'w1' },
      { kind: 'write', name: 'w2' },
    ],
    runningAtOnce: ['w1'],
    startOrder: ['w1', 'w2'],
  },
];

for (const scenario of cases) {
  test(`build output lock: ${scenario.title}`, async () => {
    const lock = createBuildOutputLock();
    const running = new Set<string>();
    const started: string[] = [];
    const gates = new Map<string, Gate>();
    const finished: Promise<unknown>[] = [];

    for (const step of scenario.steps) {
      const gate = createGate();
      gates.set(step.name, gate);
      const task = async () => {
        running.add(step.name);
        started.push(step.name);
        await gate.promise;
        running.delete(step.name);
      };
      finished.push(step.kind === 'read' ? lock.read(task) : lock.write(task));
    }
    await settle();
    expect(Array.from(running).sort()).toEqual([...scenario.runningAtOnce].sort());

    while (running.size > 0) {
      for (const name of Array.from(running)) {
        gates.get(name)?.open();
      }
      await settle();
    }
    await Promise.all(finished);
    expect(started).toEqual([...scenario.startOrder]);
  });
}

test('build output lock releases after a task throws', async () => {
  const lock = createBuildOutputLock();
  await expect(lock.write(async () => Promise.reject(new Error('build failed')))).rejects.toThrow(
    'build failed',
  );
  await expect(lock.read(async () => Promise.reject(new Error('read failed')))).rejects.toThrow(
    'read failed',
  );
  expect(await lock.read(async () => 'read')).toBe('read');
  expect(await lock.write(async () => 'write')).toBe('write');
});

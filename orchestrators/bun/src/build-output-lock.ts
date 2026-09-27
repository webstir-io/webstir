/**
 * Orders reads of a build output against the builds that replace it. Any number of reads run
 * together; a build waits for the reads in flight and runs alone, and reads that arrive while a
 * build is running or waiting start after it, so a request never sees a half-written output.
 */
export interface BuildOutputLock {
  read<T>(task: () => Promise<T>): Promise<T>;
  write<T>(task: () => Promise<T>): Promise<T>;
}

export function createBuildOutputLock(): BuildOutputLock {
  let activeReads = 0;
  let writing = false;
  const waitingWrites: Array<() => void> = [];
  let waitingReads: Array<() => void> = [];

  const next = () => {
    if (writing || activeReads > 0) {
      return;
    }
    const write = waitingWrites.shift();
    if (write) {
      writing = true;
      write();
      return;
    }
    const reads = waitingReads;
    waitingReads = [];
    activeReads += reads.length;
    for (const read of reads) {
      read();
    }
  };

  return {
    async read(task) {
      if (writing || waitingWrites.length > 0) {
        await new Promise<void>((resolve) => waitingReads.push(resolve));
      } else {
        activeReads += 1;
      }
      try {
        return await task();
      } finally {
        activeReads -= 1;
        next();
      }
    },
    async write(task) {
      await new Promise<void>((resolve) => {
        waitingWrites.push(resolve);
        next();
      });
      try {
        return await task();
      } finally {
        writing = false;
        next();
      }
    },
  };
}

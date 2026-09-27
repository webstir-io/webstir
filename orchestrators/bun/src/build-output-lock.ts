/**
 * Orders reads of a build output against the builds that replace it. Any number of reads run
 * together, and a build waits for the reads in flight and runs alone, so a request never sees a
 * half-written output. A read waits only while a build runs, never for one that is waiting, so a
 * read made while serving another read cannot deadlock behind a queued build.
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
    if (writing) {
      return;
    }
    if (waitingReads.length > 0) {
      const reads = waitingReads;
      waitingReads = [];
      activeReads += reads.length;
      for (const read of reads) {
        read();
      }
      return;
    }
    if (activeReads > 0) {
      return;
    }
    const write = waitingWrites.shift();
    if (write) {
      writing = true;
      write();
    }
  };

  return {
    async read(task) {
      if (writing) {
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

import { describe, expect, it } from 'vitest';
import { SerialExecutor } from '@/services/database/SerialExecutor';

describe('SerialExecutor', () => {
  it('runs enqueued operations in FIFO order without overlapping', async () => {
    const executor = new SerialExecutor();
    const events: string[] = [];
    const firstGate = createGate();
    const secondGate = createGate();

    const first = executor.run(async () => {
      events.push('first:start');
      await firstGate.promise;
      events.push('first:end');
      return 'first';
    });
    const second = executor.run(async () => {
      events.push('second:start');
      await secondGate.promise;
      events.push('second:end');
      return 'second';
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    firstGate.resolve();
    await first;
    await Promise.resolve();
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);

    secondGate.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('continues processing later operations after a rejection', async () => {
    const executor = new SerialExecutor();
    const events: string[] = [];

    const failing = executor.run(async () => {
      events.push('fail:start');
      throw new Error('boom');
    });
    const succeeding = executor.run(async () => {
      events.push('success:start');
      return 'recovered';
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(succeeding).resolves.toBe('recovered');
    expect(events).toEqual(['fail:start', 'success:start']);
  });
});

function createGate(): { promise: Promise<void>; resolve: () => void } {
  let resolveGate: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });

  return {
    promise,
    resolve: () => {
      if (!resolveGate) throw new Error('Gate resolver not initialized');
      resolveGate();
    },
  };
}

// CAP-fix-1: the subscriber's READY wait and stop, with a fake child (no process is spawned). A child that already
// exited must not hang the stop; a child that never prints READY must be killed.
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { hasExited, startSubscriber, stopSubscriber } from './capture-subscriber.ts';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  /** Like a real child: a kill ends the process and emits `exit`. */
  kill = vi.fn(() => {
    this.exitCode = null;
    this.signalCode = 'SIGTERM';
    this.emit('exit', null);
    return true;
  });
}

function spawnOf(child: FakeChild) {
  return () => child as unknown as ChildProcess;
}

const ARGS = { url: 'nats://127.0.0.1:4222', subjects: 'geldar.phase0.provenance.>', out: 'x' };

describe('startSubscriber', () => {
  it('resolves once READY is printed on stdout', async () => {
    const child = new FakeChild();
    const started = startSubscriber(spawnOf(child), 'capture.ts', ARGS, 1000);
    child.stdout.emit('data', Buffer.from('READY\n'));
    await expect(started).resolves.toBe(child as unknown as ChildProcess);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('accepts READY split across two chunks', async () => {
    const child = new FakeChild();
    const started = startSubscriber(spawnOf(child), 'capture.ts', ARGS, 1000);
    child.stdout.emit('data', Buffer.from('REA'));
    child.stdout.emit('data', Buffer.from('DY\n'));
    await expect(started).resolves.toBeDefined();
  });

  it('kills the child and rejects when READY never comes', async () => {
    const child = new FakeChild();
    const started = startSubscriber(spawnOf(child), 'capture.ts', ARGS, 5);
    await expect(started).rejects.toThrow(/did not print READY/);
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects with the exit code when the child exits before READY, and does not kill it again', async () => {
    const child = new FakeChild();
    const started = startSubscriber(spawnOf(child), 'capture.ts', ARGS, 1000);
    child.emit('exit', 2);
    await expect(started).rejects.toThrow(/exited \(2\) before READY/);
    expect(child.kill).not.toHaveBeenCalled();
  });
});

describe('stopSubscriber', () => {
  it('resolves at once for a child that already exited, without waiting or killing', async () => {
    const child = new FakeChild();
    child.exitCode = 0;
    await stopSubscriber(child as unknown as ChildProcess);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('resolves at once for a child that was ended by a signal', async () => {
    const child = new FakeChild();
    child.signalCode = 'SIGKILL';
    await stopSubscriber(child as unknown as ChildProcess);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills a running child and resolves when it exits', async () => {
    const child = new FakeChild();
    await stopSubscriber(child as unknown as ChildProcess);
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(hasExited(child as unknown as ChildProcess)).toBe(true);
  });
});

describe('hasExited', () => {
  it('is false for a running child and true after an exit code or a signal', () => {
    const child = new FakeChild();
    expect(hasExited(child as unknown as ChildProcess)).toBe(false);
    child.exitCode = 1;
    expect(hasExited(child as unknown as ChildProcess)).toBe(true);
  });
});

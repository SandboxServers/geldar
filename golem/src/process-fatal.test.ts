import { describe, expect, it, vi } from 'vitest';
import {
  FATAL_MESSAGE_MAX,
  FATAL_STACK_MAX,
  type FatalKind,
  type FatalProcess,
  installFatalHandlers,
} from './process-fatal.ts';

/** A fake process that keeps the installed handlers and records the exit call. */
function fakeProcess() {
  const handlers = new Map<FatalKind, (error: unknown) => void>();
  const proc: FatalProcess & { handlers: typeof handlers } = {
    handlers,
    exitCode: undefined,
    on(event, listener) {
      handlers.set(event, listener);
      return proc;
    },
    exit: vi.fn(),
  };
  return proc;
}

describe('installFatalHandlers', () => {
  it('writes one fatal line for an uncaught exception, then exits with 1', () => {
    const proc = fakeProcess();
    const log = vi.fn();
    installFatalHandlers(log, proc);
    const error = new Error('boom');
    proc.handlers.get('uncaughtException')?.(error);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({
      event: 'fatal',
      kind: 'uncaughtException',
      message: 'boom',
      stack: error.stack,
    });
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(proc.exitCode).toBe(1);
  });

  it('writes the reason of an unhandled rejection that is not an Error, then exits with 1', () => {
    const proc = fakeProcess();
    const log = vi.fn();
    installFatalHandlers(log, proc);
    proc.handlers.get('unhandledRejection')?.('no such agent');
    expect(log).toHaveBeenCalledWith({
      event: 'fatal',
      kind: 'unhandledRejection',
      message: 'no such agent',
      stack: 'no such agent',
    });
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it('still exits with 1 when the log throws', () => {
    const proc = fakeProcess();
    const log = vi.fn(() => {
      throw new Error('EPIPE');
    });
    installFatalHandlers(log, proc);
    expect(() => proc.handlers.get('uncaughtException')?.(new Error('boom'))).not.toThrow();
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(proc.exitCode).toBe(1);
  });

  it('exits with 1 for a rejection whose reason has no prototype', () => {
    const proc = fakeProcess();
    const log = vi.fn();
    installFatalHandlers(log, proc);
    proc.handlers.get('unhandledRejection')?.(Object.create(null));
    expect(log).toHaveBeenCalledWith({
      event: 'fatal',
      kind: 'unhandledRejection',
      message: '[object Object]',
      stack: '[object Object]',
    });
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it('cuts the message to FATAL_MESSAGE_MAX characters', () => {
    const proc = fakeProcess();
    const log = vi.fn();
    installFatalHandlers(log, proc);
    proc.handlers.get('unhandledRejection')?.('m'.repeat(5000));
    const line = log.mock.calls[0]?.[0] as { message: string };
    expect(line.message).toHaveLength(FATAL_MESSAGE_MAX);
  });

  it('cuts the stack to FATAL_STACK_MAX characters', () => {
    const proc = fakeProcess();
    const log = vi.fn();
    installFatalHandlers(log, proc);
    const error = new Error('long');
    error.stack = `Error: long\n${'at frame\n'.repeat(2000)}`;
    proc.handlers.get('uncaughtException')?.(error);
    const line = log.mock.calls[0]?.[0] as { stack: string };
    expect(line.stack).toHaveLength(FATAL_STACK_MAX);
    expect(line.stack.startsWith('Error: long')).toBe(true);
  });
});

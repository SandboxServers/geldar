/**
 * The last-resort handlers of a host process. An uncaught exception or an unhandled rejection
 * still ends the process, as it did before, but first it leaves one `fatal` JSON line with the
 * kind, the message and the stack, so the container's logs say why it died.
 */

/** The most message text (characters) one fatal line carries. */
export const FATAL_MESSAGE_MAX = 2000;
/** The most stack text (characters) one fatal line carries. */
export const FATAL_STACK_MAX = 4000;

/** The part of `process` the handlers use: the two events, the exit code and the exit call. */
export interface FatalProcess {
  on(event: FatalKind, listener: (error: unknown) => void): unknown;
  exitCode?: number | string | null | undefined;
  exit(code: number): void;
}

export type FatalKind = 'uncaughtException' | 'unhandledRejection';

/** A thrown value as text. One with no prototype cannot be stringified, so it reads as its type tag. */
function text(error: unknown): string {
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

/**
 * Installs the handlers on `proc` (the real process by default). On either event the handler logs
 * one `fatal` line through `log`, sets the exit code to 1 and exits with 1. The exit is called
 * right after the write, so the line is the last thing the process prints.
 */
export function installFatalHandlers(
  log: (line: Record<string, unknown>) => void,
  proc: FatalProcess = process,
): void {
  const handle = (kind: FatalKind) => (error: unknown) => {
    try {
      const stack = error instanceof Error ? error.stack : undefined;
      log({
        event: 'fatal',
        kind,
        message: (error instanceof Error ? error.message : text(error)).slice(0, FATAL_MESSAGE_MAX),
        stack: (stack ?? text(error)).slice(0, FATAL_STACK_MAX),
      });
    } catch {
      // The line could not be built or written. The exit below still runs, so the code is 1.
    }
    proc.exitCode = 1;
    proc.exit(1);
  };
  proc.on('uncaughtException', handle('uncaughtException'));
  proc.on('unhandledRejection', handle('unhandledRejection'));
}

import type {
  AuditRow,
  BodyRecord,
  BodySpec,
  LogEvent,
  StartRow,
  SupervisorDeps,
} from './ports.ts';

// An in-memory world for the supervisor's tests: the clock is fixed and moved by the test.
// Roster names and body keys are lower-cased, as the supervisor keys them (names are case-insensitive).
export class FakeWorld {
  now = new Date('2026-11-13T12:00:00.000Z');
  roster = new Map<string, string>();
  admins = new Set<string>();
  adminReadFails = false;
  // The owner's display name (the exact-case login name) for a roster name, when the test sets one. A name
  // with no entry is returned as the player name, which is in the login shape for the tests' names.
  displayNames = new Map<string, string>();
  startRows: StartRow[] = [];
  auditRows: AuditRow[] = [];
  // Bodies are keyed by the roster player name, as the supervisor keys them.
  bodies = new Map<string, BodyRecord>();
  specs: BodySpec[] = [];
  stops: string[] = [];
  // Every body helper call, in order: the verb, the owner and the roster name. A refused login name
  // makes no call here.
  calls: { verb: 'inspect' | 'start' | 'stop'; ownerId: string; playerName: string }[] = [];
  startError: Error | null = null;
  // When set, the login-name check refuses the player (the display name is missing or outside the login shape).
  loginNameBad = false;
  insertError: Error | null = null;
  auditError: Error | null = null;
  stopError: Error | null = null;
  // When set, a runtime start never answers (a hung helper call).
  hangStart = false;
  // When set, a runtime start completes this many ms later and ignores the abort signal, as a
  // helper start that was already under way would. The body then runs unless the supervisor stops it.
  lateStartMs: number | null = null;
  logs = new Map<string, LogEvent[]>();
  // Every abort signal the runtime was given, in call order (review fix E).
  signals: AbortSignal[] = [];

  addPlayer(playerName: string, ownerId: string): void {
    this.roster.set(playerName.toLowerCase(), ownerId);
  }

  deps(): SupervisorDeps {
    return {
      roster: {
        ownerOfPlayer: async (playerName) => this.roster.get(playerName) ?? null,
      },
      admins: {
        isAdmin: async (ownerId) => {
          if (this.adminReadFails) throw new Error('flag read failed');
          return this.admins.has(ownerId);
        },
      },
      displayNames: {
        displayName: async (_ownerId, playerName) => {
          if (this.loginNameBad) return null;
          return this.displayNames.get(playerName) ?? playerName;
        },
      },
      starts: {
        insert: async (row) => {
          if (this.insertError) throw this.insertError;
          this.startRows.push(row);
        },
        // A start exactly at the window's edge is outside it.
        countPlayerSince: async (playerName, since) =>
          this.startRows.filter((r) => r.playerName === playerName && r.at > since).length,
        countOwnerSince: async (ownerId, since) =>
          this.startRows.filter((r) => r.ownerId === ownerId && r.at > since).length,
      },
      audit: {
        append: async (row) => {
          if (this.auditError) throw this.auditError;
          this.auditRows.push(row);
        },
      },
      runtime: {
        inspect: async (ownerId, playerName) => {
          this.calls.push({ verb: 'inspect', ownerId, playerName });
          const body = this.bodies.get(playerName);
          return body ? { ...body } : null;
        },
        start: async (spec, signal) => {
          this.calls.push({ verb: 'start', ownerId: spec.ownerId, playerName: spec.playerName });
          if (signal) this.signals.push(signal);
          if (this.hangStart) return new Promise<void>(() => undefined);
          if (this.startError) throw this.startError;
          if (this.lateStartMs !== null) {
            await new Promise((resolve) => setTimeout(resolve, this.lateStartMs ?? 0));
          }
          this.specs.push(spec);
          this.bodies.set(spec.playerName, {
            ownerId: spec.ownerId,
            playerName: spec.playerName,
            running: true,
          });
        },
        stop: async (ownerId, playerName) => {
          this.calls.push({ verb: 'stop', ownerId, playerName });
          this.stops.push(playerName);
          if (this.stopError) throw this.stopError;
          const body = this.bodies.get(playerName);
          if (body) body.running = false;
        },
      },
      logs: {
        recent: async (playerName, limit) => (this.logs.get(playerName) ?? []).slice(-limit),
      },
      now: () => new Date(this.now),
    };
  }
}

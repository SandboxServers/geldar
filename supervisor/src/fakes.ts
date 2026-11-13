import type {
  AuditRow,
  BodyRecord,
  BodySpec,
  LogEvent,
  StartRow,
  SupervisorDeps,
} from './ports.ts';

// An in-memory world for the supervisor's tests: the clock is fixed and moved by the test.
export class FakeWorld {
  now = new Date('2026-11-13T12:00:00.000Z');
  roster = new Map<string, string>();
  admins = new Set<string>();
  adminReadFails = false;
  startRows: StartRow[] = [];
  auditRows: AuditRow[] = [];
  bodies = new Map<string, BodyRecord>();
  specs: BodySpec[] = [];
  stops: string[] = [];
  startError: Error | null = null;
  auditError: Error | null = null;
  logs = new Map<string, LogEvent[]>();

  addPlayer(playerName: string, ownerId: string): void {
    this.roster.set(playerName, ownerId);
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
      starts: {
        insert: async (row) => {
          this.startRows.push(row);
        },
        // A start exactly at the window's edge is outside it.
        countAgentSince: async (agentId, since) =>
          this.startRows.filter((r) => r.agentId === agentId && r.at > since).length,
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
        inspect: async (agentId) => {
          const body = this.bodies.get(agentId);
          return body ? { ...body } : null;
        },
        start: async (spec) => {
          if (this.startError) throw this.startError;
          this.specs.push(spec);
          this.bodies.set(spec.agentId, {
            ownerId: spec.ownerId,
            playerName: spec.playerName,
            running: true,
          });
        },
        stop: async (agentId) => {
          this.stops.push(agentId);
          const body = this.bodies.get(agentId);
          if (body) body.running = false;
        },
      },
      logs: {
        recent: async (agentId, limit) => (this.logs.get(agentId) ?? []).slice(-limit),
      },
      now: () => new Date(this.now),
    };
  }
}

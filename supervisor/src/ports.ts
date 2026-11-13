// The supervisor's ports. Every side effect (roster, admin flag, start counters, audit, Docker, logs)
// sits behind one of these, so the policy in service.ts runs against fakes in tests.

export const OPS = ['start', 'stop', 'restart', 'status', 'logtail'] as const;
export type Op = (typeof OPS)[number];

// A body is keyed by the roster player's Minecraft name. The request carries no agent id: an id
// the caller chose could be claimed for any name, and one name could start many bodies under
// fresh ids (review fix B, F2). The roster is the only source of which owner holds a name.
export interface ControlRequest {
  op: Op;
  ownerId: string;
  playerName: string;
}

// Fixed-text codes only: a log event never carries free text (decision 0085).
export type LogCode = 'started' | 'stopped' | 'restarted' | 'crashed' | 'refused' | 'other';
export interface LogEvent {
  at: Date;
  code: LogCode;
}

export type ReplyCode = 'started' | 'restarted' | 'stopped' | 'running' | 'idle' | 'logs';
// `unknown` covers a wrong owner, an unknown player and a body the caller does not hold: one reply
// for all of them.
export type Refusal = 'invalid' | 'unknown' | 'quota' | 'error';
export type Reply =
  | { ok: true; code: ReplyCode; events?: LogEvent[] }
  | { ok: false; code: Refusal };

export interface RosterPort {
  ownerOfPlayer(playerName: string): Promise<string | null>;
}

export interface AdminFlagPort {
  isAdmin(ownerId: string): Promise<boolean>;
}

export interface StartRow {
  ownerId: string;
  playerName: string;
  op: 'start' | 'restart';
  at: Date;
}

export interface StartCountsPort {
  insert(row: StartRow): Promise<void>;
  countPlayerSince(playerName: string, since: Date): Promise<number>;
  countOwnerSince(ownerId: string, since: Date): Promise<number>;
}

export interface AuditRow {
  actor: string;
  action: string;
  target: string;
  outcome: string;
  admin: boolean;
  detail: string;
}

export interface AuditPort {
  append(row: AuditRow): Promise<void>;
}

export interface ContainerConfig {
  NanoCpus: number;
  Memory: number;
  MemorySwap: number;
}

export interface BodySpec {
  ownerId: string;
  playerName: string;
  config: ContainerConfig;
}

export interface BodyRecord {
  ownerId: string;
  playerName: string;
  running: boolean;
}

export interface BodyRuntimePort {
  inspect(playerName: string): Promise<BodyRecord | null>;
  start(spec: BodySpec): Promise<void>;
  stop(playerName: string): Promise<void>;
}

export interface LogPort {
  recent(playerName: string, limit: number): Promise<LogEvent[]>;
}

export interface SupervisorDeps {
  roster: RosterPort;
  admins: AdminFlagPort;
  starts: StartCountsPort;
  audit: AuditPort;
  runtime: BodyRuntimePort;
  logs: LogPort;
  now: () => Date;
  // Bound on each runtime (Docker) call; a call that does not answer in time is an error reply.
  runtimeTimeoutMs?: number;
}

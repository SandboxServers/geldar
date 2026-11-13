// The supervisor's ports. Every side effect (roster, admin flag, start counters, audit, Docker, logs)
// sits behind one of these, so the policy in service.ts runs against fakes in tests.

export const OPS = ['start', 'stop', 'restart', 'status', 'logtail'] as const;
export type Op = (typeof OPS)[number];

export interface ControlRequest {
  op: Op;
  ownerId: string;
  agentId: string;
  playerName: string;
}

// Fixed-text codes only: a log event never carries free text (decision 0085).
export type LogCode = 'started' | 'stopped' | 'restarted' | 'crashed' | 'refused' | 'other';
export interface LogEvent {
  at: Date;
  code: LogCode;
}

export type ReplyCode = 'started' | 'restarted' | 'stopped' | 'running' | 'idle' | 'logs';
// `unknown` covers a wrong owner, an unknown player and an unknown agent: one reply for all three.
export type Refusal = 'invalid' | 'unknown' | 'quota' | 'conflict' | 'error';
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
  agentId: string;
  op: 'start' | 'restart';
  at: Date;
}

export interface StartCountsPort {
  insert(row: StartRow): Promise<void>;
  countAgentSince(agentId: string, since: Date): Promise<number>;
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
  agentId: string;
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
  inspect(agentId: string): Promise<BodyRecord | null>;
  start(spec: BodySpec): Promise<void>;
  stop(agentId: string): Promise<void>;
}

export interface LogPort {
  recent(agentId: string, limit: number): Promise<LogEvent[]>;
}

export interface SupervisorDeps {
  roster: RosterPort;
  admins: AdminFlagPort;
  starts: StartCountsPort;
  audit: AuditPort;
  runtime: BodyRuntimePort;
  logs: LogPort;
  now: () => Date;
}

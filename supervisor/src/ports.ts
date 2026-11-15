// The supervisor's ports. Every side effect (roster, admin flag, display name, start counters, audit,
// the body helper, logs) sits behind one of these, so the policy in service.ts runs against fakes in tests.

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
// `login_name` is the owner's to fix: the player's name is not in the Minecraft login shape. `busy`
// is answered by the NATS wire, not by the service; it is listed so the type matches the wire.
export type Refusal = 'invalid' | 'unknown' | 'quota' | 'error' | 'busy' | 'login_name';
export type Reply =
  | { ok: true; code: ReplyCode; events?: LogEvent[] }
  | { ok: false; code: Refusal };

// The login-name check throws this when the owner's display name is missing or outside the login shape.
// The service maps it to the `login_name` refusal, which does not count against a quota.
export class LoginNameError extends Error {
  constructor() {
    super('login name unknown');
    this.name = 'LoginNameError';
  }
}

export interface RosterPort {
  ownerOfPlayer(playerName: string): Promise<string | null>;
}

export interface AdminFlagPort {
  isAdmin(ownerId: string): Promise<boolean>;
}

// The exact-case login name of the owner's player for a roster name (0033), or null when no single
// spelling is known. The service refuses a start on null (`login_name`); a failed read throws.
export interface DisplayNamePort {
  displayName(ownerId: string, playerName: string): Promise<string | null>;
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

export interface BodySpec {
  ownerId: string;
  playerName: string;
}

export interface BodyRecord {
  ownerId: string;
  playerName: string;
  running: boolean;
}

// The body helper's verbs (`status`, `start`, `stop`), as the service uses them. Every call carries the
// owner and the roster name: the helper checks the roster against the owner and refuses a name the owner
// does not hold. Logs are read from the database through the LogPort, not from the helper.
// `signal` aborts when the supervisor gives up on a start (its timeout); the helper client does not use it,
// so a late start is compensated by a stop once it lands (service.ts).
export interface BodyRuntimePort {
  inspect(ownerId: string, playerName: string): Promise<BodyRecord | null>;
  start(spec: BodySpec, signal?: AbortSignal): Promise<void>;
  stop(ownerId: string, playerName: string): Promise<void>;
}

// Fixed fields only: the lost row's error text never leaves the supervisor.
export interface AuditLostInfo {
  action: string;
  code: 'audit_lost';
}

export interface LogPort {
  recent(playerName: string, limit: number): Promise<LogEvent[]>;
}

export interface SupervisorDeps {
  roster: RosterPort;
  admins: AdminFlagPort;
  displayNames: DisplayNamePort;
  starts: StartCountsPort;
  audit: AuditPort;
  runtime: BodyRuntimePort;
  logs: LogPort;
  now: () => Date;
  // Bound on each body helper call. It sits above the helper client's own 20 s bound, so the client's
  // `timeout` answers first; this bound is the service's backstop.
  runtimeTimeoutMs?: number;
  // Called when a successful start or stop could not be audited, so the lost row is visible.
  onAuditLost?: (info: AuditLostInfo) => void;
}

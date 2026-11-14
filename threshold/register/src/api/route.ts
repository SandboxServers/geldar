import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OwnerKeyScope } from '../owner-keys-policy.ts';
import type { OwnerKeyStore } from '../owner-keys-service.ts';
import type { SessionStore } from '../session-store.ts';

/** One audit row an owner API route writes. The owner and the admin flag are filled in by the router. */
export interface ApiAuditEntry {
  ownerId: string;
  action: string;
  target: string;
  outcome: string;
  admin: boolean;
}

export interface ApiContext {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly deps: ApiDeps;
  /** Captured path segments, in pattern order. */
  readonly params: readonly string[];
  readonly ownerId: string;
  readonly admin: boolean;
  /** Writes one audit row. A failed write calls onAuditLost and the request ends 500 internal. */
  audit(entry: { action: string; target: string; outcome: string }): Promise<void>;
}

export interface ApiRoute {
  readonly method: string;
  /** Matches the path after /api/v1 (for example /agents/abc). Capture groups become params. */
  readonly pattern: RegExp;
  readonly scope: OwnerKeyScope;
  /** A state-changing route: a cookie request needs the CSRF header, and the owner window applies. */
  readonly write: boolean;
  readonly handler: (ctx: ApiContext) => Promise<void>;
}

export interface ApiDeps {
  readonly now: () => number;
  /** The key the CSRF token is derived from (the session key). */
  readonly csrfKey: string;
  readonly sessions?: SessionStore | undefined;
  /** The owner key resolve (C7-02b). Without it a Bearer credential is refused. */
  readonly ownerKeys?: { store: OwnerKeyStore; hash: (value: string) => Buffer };
  /** Loads an agent of the owner. The loader filters by owner; a missing agent is null. */
  readonly agents?: (ownerId: string, playerId: string) => Promise<Record<string, unknown> | null>;
  readonly audit?: ((entry: ApiAuditEntry) => Promise<void>) | undefined;
  readonly onAuditLost?: (entry: ApiAuditEntry) => void;
  /** Reads the admin flag per request. A throw or a missing hook means not admin (fail closed to the limit). */
  readonly isAdmin?: (ownerId: string) => Promise<boolean>;
  /** The owner window for writes: seconds to wait, or 0 when the write may go on. */
  readonly charge?: (ownerId: string) => number;
  /** Extra routes (tests and later resource cards). */
  readonly routes?: readonly ApiRoute[];
}

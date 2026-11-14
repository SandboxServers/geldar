import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OnboardingHandoff } from '../onboarding-pages.ts';
import type { OwnerKeyScope } from '../owner-keys-policy.ts';
import type { OwnerKeyStore, SessionKeyDeps } from '../owner-keys-service.ts';
import type { SessionStore } from '../session-store.ts';
import type { TokenDeps } from '../tokens-service.ts';

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
  /** The signed-in identity (hex) of a cookie session; null for a Bearer key. */
  readonly identityHash: string | null;
  /** The session key (hex, the session hash) of a cookie session: the onboarding slot's key. Null for a key. */
  readonly sessionKey: string | null;
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
  /** Accepts a cookie session only (decision 0173): a Bearer owner key is refused 401 unauthenticated. */
  readonly cookieOnly?: boolean;
  readonly handler: (ctx: ApiContext) => Promise<void>;
}

/** The visibility flag writes of an agent (C7-04e). The database checks the owner by identity hash. */
export interface AgentFlagStore {
  setPublicCamera(identityHash: string, playerId: string, value: boolean): Promise<boolean>;
  setThoughtsDelayedPublic(
    identityHash: string,
    playerId: string,
    value: boolean,
  ): Promise<boolean>;
}

export interface ApiDeps {
  readonly now: () => number;
  /** The visibility flag writes (C7-04e). Without it PATCH /agents/{playerId} answers 500 internal. */
  readonly flags?: AgentFlagStore | undefined;
  /** The key the CSRF token is derived from (the session key). */
  readonly csrfKey: string;
  readonly sessions?: SessionStore | undefined;
  /** The owner key resolve (C7-02b). Without it a Bearer credential is refused. */
  readonly ownerKeys?: { store: OwnerKeyStore; hash: (value: string) => Buffer };
  /** The token services (C7-04b). Their charge is not used: the router's window is the one charge. */
  readonly tokens?: TokenDeps;
  /** The onboarding slot the account page uses (C7-05). A rotated token is held here for the session. */
  readonly handoff?: OnboardingHandoff | undefined;
  /** The cookie-session owner key services (migration 0035). Their charge is not used either. */
  readonly ownerKeySessions?: SessionKeyDeps;
  /** Loads an agent of the owner. The loader filters by owner; a missing agent is null. */
  readonly agents?: (ownerId: string, playerId: string) => Promise<Record<string, unknown> | null>;
  /** Lists the owner's agents. Without it the list route answers 500 internal (never an empty list). */
  readonly listAgents?: (ownerId: string) => Promise<Record<string, unknown>[]>;
  readonly audit?: ((entry: ApiAuditEntry) => Promise<void>) | undefined;
  readonly onAuditLost?: (entry: ApiAuditEntry) => void;
  /** Reads the admin flag per request. A throw or a missing hook means not admin (fail closed to the limit). */
  readonly isAdmin?: (ownerId: string) => Promise<boolean>;
  /** The owner window for writes: seconds to wait, or 0 when the write may go on. */
  readonly charge?: (ownerId: string) => number;
  /** Extra routes (tests and later resource cards). */
  readonly routes?: readonly ApiRoute[];
}

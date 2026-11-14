import {
  pgAdminFlags,
  pgAudit,
  pgLogs,
  pgRoster,
  pgStartCounts,
  type SqlQuery,
} from './pg-ports.ts';
import type { AuditLostInfo, BodyRuntimePort, SupervisorDeps } from './ports.ts';

export interface CompositionInput {
  // The database query, as the role geldar_supervisor (the caller opens the pool and reads the secret).
  query: SqlQuery;
  runtime: BodyRuntimePort;
  // Receives the fixed fields of a lost audit row; the supervisor never passes free text.
  log: (info: AuditLostInfo) => void;
  now?: () => Date;
  runtimeTimeoutMs?: number;
}

// The composition root for the supervisor's deps: the Postgres adapters, the Docker runtime and the
// audit-lost hook. Without the hook a lost audit row after an ok reply is silent (review fix E).
export function buildSupervisorDeps(input: CompositionInput): SupervisorDeps {
  return {
    roster: pgRoster(input.query),
    admins: pgAdminFlags(input.query),
    starts: pgStartCounts(input.query),
    audit: pgAudit(input.query),
    logs: pgLogs(input.query),
    runtime: input.runtime,
    now: input.now ?? (() => new Date()),
    ...(input.runtimeTimeoutMs === undefined ? {} : { runtimeTimeoutMs: input.runtimeTimeoutMs }),
    onAuditLost: (info) => input.log(info),
  };
}

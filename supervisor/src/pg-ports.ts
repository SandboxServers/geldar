import type {
  AdminFlagPort,
  AuditPort,
  AuditRow,
  DisplayNamePort,
  LogEvent,
  LogPort,
  RosterPort,
  StartCountsPort,
  StartRow,
} from './ports.ts';

// The one query shape the adapters need. A pg Pool fits it through a one-line wrapper in the
// composition root, so these adapters run against a recording fake in tests.
export type SqlQuery = (
  text: string,
  params: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;

// Every statement below names only the relations the supervisor role is granted (0024, 0025, 0027):
// SELECT on mcp_roster and body_ops, INSERT on body_ops and register_audit, EXECUTE on
// supervisor_is_admin. There is no UPDATE and no DELETE. pg-ports.test.ts checks the SQL text.
// A database error is not caught here, except where the port says a failure is `false`: the
// supervisor turns a thrown error into a fixed `error` reply, so the caller never sees the text.

export function pgRoster(query: SqlQuery): RosterPort {
  return {
    async ownerOfPlayer(playerName) {
      const { rows } = await query('SELECT owner_id FROM mcp_roster WHERE player_name = $1', [
        playerName.toLowerCase(),
      ]);
      const owner = rows[0]?.owner_id;
      return typeof owner === 'string' ? owner : null;
    },
  };
}

// The exact-case login name (0033). The read goes through supervisor_player_display_name, so the role
// never reads mcp_players. A null is no single known spelling, and the caller refuses the start. A
// failed read throws; it is never replaced by the lower-cased key.
export function pgDisplayNames(query: SqlQuery): DisplayNamePort {
  return {
    async displayName(ownerId, playerName) {
      const { rows } = await query('SELECT supervisor_player_display_name($1, $2) AS name', [
        ownerId,
        playerName.toLowerCase(),
      ]);
      const name = rows[0]?.name;
      return typeof name === 'string' ? name : null;
    },
  };
}

// The flag is read through supervisor_is_admin (ruling b), never from a column. A missing owner and
// a failed read are both `false`, so the limits apply (decision 0170).
export function pgAdminFlags(query: SqlQuery): AdminFlagPort {
  return {
    async isAdmin(ownerId) {
      try {
        const { rows } = await query('SELECT supervisor_is_admin($1) AS admin', [ownerId]);
        return rows[0]?.admin === true;
      } catch {
        return false;
      }
    },
  };
}

async function countRows(query: SqlQuery, text: string, params: unknown[]): Promise<number> {
  const { rows } = await query(text, params);
  const n = rows[0]?.n;
  // An unreadable count throws: the supervisor refuses the start, it does not guess a count.
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) throw new Error('count unreadable');
  return n;
}

// body_ops is the only write the supervisor makes to its counters, and it is append-only.
export function pgStartCounts(query: SqlQuery): StartCountsPort {
  return {
    async insert(row: StartRow) {
      await query('INSERT INTO body_ops (owner_id, player_name, op, at) VALUES ($1, $2, $3, $4)', [
        row.ownerId,
        row.playerName.toLowerCase(),
        row.op,
        row.at,
      ]);
    },
    countPlayerSince(playerName, since) {
      return countRows(
        query,
        'SELECT count(*)::int AS n FROM body_ops WHERE player_name = $1 AND at > $2',
        [playerName.toLowerCase(), since],
      );
    },
    countOwnerSince(ownerId, since) {
      return countRows(
        query,
        'SELECT count(*)::int AS n FROM body_ops WHERE owner_id = $1 AND at > $2',
        [ownerId, since],
      );
    },
  };
}

export function pgAudit(query: SqlQuery): AuditPort {
  return {
    async append(row: AuditRow) {
      await query(
        'INSERT INTO register_audit (actor, action, target, outcome, admin, detail) VALUES ($1, $2, $3, $4, $5, $6)',
        [row.actor, row.action, row.target, row.outcome, row.admin, row.detail],
      );
    },
  };
}

// The events are the supervisor's own start rows, so a log line never carries container text
// (decision 0085). The read is bounded to the current roster record: a start counts for this record
// only when it is at or after the record's creation and was made by its owner. A new roster owner
// therefore sees none of the previous owner's events. Stops are not rows, so they are not events.
export function pgLogs(query: SqlQuery): LogPort {
  return {
    async recent(playerName, limit) {
      const { rows } = await query(
        `SELECT b.op, b.at FROM body_ops b
           JOIN mcp_roster r ON r.player_name = b.player_name AND r.owner_id = b.owner_id
          WHERE b.player_name = $1 AND b.at >= r.created_at
          ORDER BY b.at DESC, b.id DESC LIMIT $2`,
        [playerName.toLowerCase(), limit],
      );
      // The query is newest first; the supervisor's tail wants oldest first.
      return rows
        .map(
          (row): LogEvent => ({
            at: new Date(row.at as string | Date),
            code: row.op === 'restart' ? 'restarted' : 'started',
          }),
        )
        .reverse();
    },
  };
}

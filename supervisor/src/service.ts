import { createHash } from 'node:crypto';
import { bodyContainerConfig } from './limits.ts';
import {
  type BodyRecord,
  type ControlRequest,
  OPS,
  type Reply,
  type SupervisorDeps,
} from './ports.ts';
import {
  dayAgo,
  hourAgo,
  LOG_TAIL_LIMIT,
  LOG_TAIL_WINDOW_MS,
  STARTS_PER_AGENT_PER_HOUR,
  STARTS_PER_OWNER_PER_DAY,
} from './quotas.ts';

export interface Supervisor {
  handle(request: unknown): Promise<Reply>;
}

// What one attempt did, for the reply and for the audit row.
interface Outcome {
  reply: Reply;
  auditOutcome: string;
  admin: boolean;
  detail: string;
}

function outcome(reply: Reply, admin: boolean, detail = ''): Outcome {
  return { reply, auditOutcome: reply.ok ? 'ok' : reply.code, admin, detail };
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= max;
}

// Runtime shape check: control requests arrive over NATS and are untrusted.
export function wellFormed(request: unknown): request is ControlRequest {
  if (typeof request !== 'object' || request === null) return false;
  const r = request as Record<string, unknown>;
  return (
    typeof r.op === 'string' &&
    (OPS as readonly string[]).includes(r.op) &&
    text(r.ownerId, 64) &&
    text(r.agentId, 128) &&
    text(r.playerName, 64)
  );
}

// The audit actor is a hash of the owner id, so the audit shows no owner name (decision 0085).
function actorOf(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 16);
}

export function createSupervisor(deps: SupervisorDeps): Supervisor {
  // One queue per owner: the counters and the running check are read and written under it, so two
  // starts that race (for one agent or for two of one owner's agents) cannot both pass.
  const queues = new Map<string, Promise<void>>();

  function serialise(key: string, job: () => Promise<Outcome>): Promise<Outcome> {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.then(job);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  }

  // A failed admin-flag read is treated as not admin: the limits apply (decision 0170).
  async function isAdmin(ownerId: string): Promise<boolean> {
    try {
      return (await deps.admins.isAdmin(ownerId)) === true;
    } catch {
      return false;
    }
  }

  async function startOrRestart(
    request: ControlRequest,
    record: BodyRecord | null,
    admin: boolean,
  ): Promise<Outcome> {
    const { ownerId, agentId, playerName } = request;
    const rosterOwner = await deps.roster.ownerOfPlayer(playerName);
    if (rosterOwner !== ownerId) return outcome({ ok: false, code: 'unknown' }, admin);
    if (record !== null && record.ownerId !== ownerId) {
      return outcome({ ok: false, code: 'unknown' }, admin);
    }
    // One running body per agent: always, admins included. A restart replaces the body.
    if (request.op === 'start' && record?.running) {
      return outcome({ ok: false, code: 'conflict' }, admin);
    }
    // Start counters: admins are exempt (decision 0170, point 5). A refused request never reaches
    // the insert below, so it does not count.
    if (!admin) {
      const now = deps.now();
      if ((await deps.starts.countAgentSince(agentId, hourAgo(now))) >= STARTS_PER_AGENT_PER_HOUR) {
        return outcome({ ok: false, code: 'quota' }, admin, 'agent_hour');
      }
      if ((await deps.starts.countOwnerSince(ownerId, dayAgo(now))) >= STARTS_PER_OWNER_PER_DAY) {
        return outcome({ ok: false, code: 'quota' }, admin, 'owner_day');
      }
    }
    if (record?.running) await deps.runtime.stop(agentId);
    // A Docker error throws here: no row is inserted, so the failed start does not count.
    await deps.runtime.start({
      agentId,
      ownerId,
      playerName,
      config: bodyContainerConfig(),
    });
    const op = request.op === 'restart' ? 'restart' : 'start';
    await deps.starts.insert({ ownerId, agentId, op, at: deps.now() });
    return outcome({ ok: true, code: op === 'restart' ? 'restarted' : 'started' }, admin);
  }

  async function logtail(agentId: string, admin: boolean): Promise<Outcome> {
    const cutoff = deps.now().getTime() - LOG_TAIL_WINDOW_MS;
    const recent = await deps.logs.recent(agentId, LOG_TAIL_LIMIT);
    const events = recent.filter((event) => event.at.getTime() >= cutoff).slice(-LOG_TAIL_LIMIT);
    return outcome({ ok: true, code: 'logs', events }, admin);
  }

  async function act(request: ControlRequest, admin: boolean): Promise<Outcome> {
    const record = await deps.runtime.inspect(request.agentId);
    if (request.op === 'start' || request.op === 'restart') {
      return startOrRestart(request, record, admin);
    }
    // Stop, status and logtail: a wrong owner and an unknown agent get the same reply, and none of
    // these count toward the quotas.
    if (record === null || record.ownerId !== request.ownerId) {
      return outcome({ ok: false, code: 'unknown' }, admin);
    }
    if (request.op === 'stop') {
      await deps.runtime.stop(request.agentId);
      return outcome({ ok: true, code: 'stopped' }, admin);
    }
    if (request.op === 'status') {
      return outcome({ ok: true, code: record.running ? 'running' : 'idle' }, admin);
    }
    return logtail(request.agentId, admin);
  }

  async function attempt(request: ControlRequest): Promise<Outcome> {
    const admin = await isAdmin(request.ownerId);
    try {
      return await act(request, admin);
    } catch {
      // The Docker or database error is reported as a fixed code; the detail stays out of the reply.
      return outcome({ ok: false, code: 'error' }, admin, 'runtime');
    }
  }

  return {
    async handle(request: unknown): Promise<Reply> {
      const shaped = wellFormed(request);
      const result = shaped
        ? await serialise(request.ownerId, () => attempt(request))
        : outcome({ ok: false, code: 'invalid' }, false);
      // The audit row is written for every attempt, refusals included. An audit write that fails
      // throws, so the caller gets no reply rather than an unaudited one.
      await deps.audit.append({
        actor: shaped ? actorOf(request.ownerId) : 'invalid',
        action: shaped ? `body_${request.op}` : 'body_invalid',
        target: shaped ? request.agentId : 'invalid',
        outcome: result.auditOutcome,
        admin: result.admin,
        detail: result.detail,
      });
      return result.reply;
    },
  };
}

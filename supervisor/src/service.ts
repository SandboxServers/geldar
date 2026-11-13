import { createHash } from 'node:crypto';
import { bodyContainerConfig } from './limits.ts';
import {
  type BodyRecord,
  type BodyRuntimePort,
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

// Bound on one Docker call. A hung call must not hold the owner's queue (review fix B, F7).
export const RUNTIME_TIMEOUT_MS = 15_000;

// Status and logtail change nothing, so they are not audited: polling would grow the append-only
// audit table without bound.
const READ_ONLY_OPS: ReadonlySet<string> = new Set(['status', 'logtail']);

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
    text(r.playerName, 64)
  );
}

// The audit actor is a hash of the owner id, so the audit shows no owner name (decision 0085).
function actorOf(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 16);
}

function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('runtime call timed out')), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

function boundedRuntime(runtime: BodyRuntimePort, ms: number): BodyRuntimePort {
  return {
    inspect: (playerName) => bounded(runtime.inspect(playerName), ms),
    start: (spec) => bounded(runtime.start(spec), ms),
    stop: (playerName) => bounded(runtime.stop(playerName), ms),
  };
}

export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const runtime = boundedRuntime(deps.runtime, deps.runtimeTimeoutMs ?? RUNTIME_TIMEOUT_MS);
  // One queue per owner: the counters and the running check are read and written under it, so two
  // starts that race (for one name or for two of one owner's names) cannot both pass.
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
    const { ownerId, playerName, op } = request;
    // The roster names the owner of the player. A body held by another owner stays theirs even when
    // the roster has since moved the name to the caller.
    const rosterOwner = await deps.roster.ownerOfPlayer(playerName);
    if (rosterOwner !== ownerId) return outcome({ ok: false, code: 'unknown' }, admin);
    if (record !== null && record.ownerId !== ownerId) {
      return outcome({ ok: false, code: 'unknown' }, admin);
    }
    // A repeat start while this owner's body runs is the same request again: it changes nothing
    // and counts nothing. A restart replaces the body.
    if (op === 'start' && record?.running) return outcome({ ok: true, code: 'started' }, admin);
    // Start counters: admins are exempt (decision 0170, point 5). A refused request never reaches
    // the insert below, so it does not count.
    if (!admin) {
      const now = deps.now();
      if (
        (await deps.starts.countPlayerSince(playerName, hourAgo(now))) >= STARTS_PER_AGENT_PER_HOUR
      ) {
        return outcome({ ok: false, code: 'quota' }, admin, 'agent_hour');
      }
      if ((await deps.starts.countOwnerSince(ownerId, dayAgo(now))) >= STARTS_PER_OWNER_PER_DAY) {
        return outcome({ ok: false, code: 'quota' }, admin, 'owner_day');
      }
    }
    if (record?.running) await runtime.stop(playerName);
    // A Docker error throws here: no row is inserted, so the failed start does not count.
    await runtime.start({ ownerId, playerName, config: bodyContainerConfig() });
    const startOp = op === 'restart' ? 'restart' : 'start';
    try {
      await deps.starts.insert({ ownerId, playerName, op: startOp, at: deps.now() });
    } catch (error) {
      // The body is up but no row counts it: stop it, so no body runs uncounted, then report.
      await runtime.stop(playerName);
      throw error;
    }
    return outcome({ ok: true, code: startOp === 'restart' ? 'restarted' : 'started' }, admin);
  }

  async function logtail(playerName: string, admin: boolean): Promise<Outcome> {
    const cutoff = deps.now().getTime() - LOG_TAIL_WINDOW_MS;
    const recent = await deps.logs.recent(playerName, LOG_TAIL_LIMIT);
    const events = recent.filter((event) => event.at.getTime() >= cutoff).slice(-LOG_TAIL_LIMIT);
    return outcome({ ok: true, code: 'logs', events }, admin);
  }

  async function act(request: ControlRequest, admin: boolean): Promise<Outcome> {
    const record = await runtime.inspect(request.playerName);
    if (request.op === 'start' || request.op === 'restart') {
      return startOrRestart(request, record, admin);
    }
    // Stop, status and logtail need the roster owner and the body owner to be the caller. A wrong
    // owner, an unknown name and no body all get the same reply, and none of these count.
    const rosterOwner = await deps.roster.ownerOfPlayer(request.playerName);
    if (rosterOwner !== request.ownerId || record === null || record.ownerId !== request.ownerId) {
      return outcome({ ok: false, code: 'unknown' }, admin);
    }
    if (request.op === 'stop') {
      await runtime.stop(request.playerName);
      return outcome({ ok: true, code: 'stopped' }, admin);
    }
    if (request.op === 'status') {
      return outcome({ ok: true, code: record.running ? 'running' : 'idle' }, admin);
    }
    return logtail(request.playerName, admin);
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
      if (shaped && READ_ONLY_OPS.has(request.op)) return result.reply;
      try {
        await deps.audit.append({
          actor: shaped ? actorOf(request.ownerId) : 'invalid',
          action: shaped ? `body_${request.op}` : 'body_invalid',
          target: shaped ? request.playerName : 'invalid',
          outcome: result.auditOutcome,
          admin: result.admin,
          detail: result.detail,
        });
      } catch (error) {
        // A start or stop that succeeded already changed the body: return its reply rather than an
        // error the caller would retry into a conflict. A refusal changed nothing, so its audit
        // failure throws and the caller gets no unaudited reply.
        if (result.reply.ok) return result.reply;
        throw error;
      }
      return result.reply;
    },
  };
}

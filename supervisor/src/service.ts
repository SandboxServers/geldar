import { createHash } from 'node:crypto';
import { bodyContainerConfig } from './limits.ts';
import {
  type BodyRecord,
  type BodySpec,
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

// A roster name is 1 to 16 letters, digits or underscores (tools/mcp-tokens/src/roster.ts).
const PLAYER_NAME = /^[A-Za-z0-9_]{1,16}$/;

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

// A repeat start of a running body: the same reply as the first start, nothing counted, and an
// audit outcome of `noop` so it is not mistaken for a body launch.
function repeatStart(admin: boolean): Outcome {
  return { reply: { ok: true, code: 'started' }, auditOutcome: 'noop', admin, detail: '' };
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
    typeof r.playerName === 'string' &&
    PLAYER_NAME.test(r.playerName)
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

function boundedCalls(runtime: SupervisorDeps['runtime'], ms: number) {
  return {
    inspect: (playerName: string) => bounded(runtime.inspect(playerName), ms),
    stop: (playerName: string) => bounded(runtime.stop(playerName), ms),
  };
}

export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const timeoutMs = deps.runtimeTimeoutMs ?? RUNTIME_TIMEOUT_MS;
  const runtime = boundedCalls(deps.runtime, timeoutMs);
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

  // Names whose running body no start row counts: a compensating stop failed, so the body may still
  // run. A repeat start must not report such a body as started; it stops and starts it again instead.
  const uncounted = new Set<string>();

  // Best-effort stop after a failed start: it cannot throw, so the error the caller sees is the
  // one that caused the compensation.
  async function compensate(playerName: string): Promise<void> {
    try {
      await runtime.stop(playerName);
      uncounted.delete(playerName);
    } catch {
      uncounted.add(playerName);
    }
  }

  // The newest start attempt per name. A late landing is compensated only while its attempt is still
  // the newest: a newer attempt owns the name, and the adapter removes the aborted container on abort.
  // Each attempt holds its own token, so a cleared entry can never match an older attempt.
  const attempts = new Map<string, object>();

  function forgetAttempt(playerName: string, token: object): void {
    if (attempts.get(playerName) === token) attempts.delete(playerName);
  }

  async function compensateLate(playerName: string, token: object): Promise<void> {
    if (attempts.get(playerName) === token) await compensate(playerName);
    forgetAttempt(playerName, token);
  }

  // Starts the body within the bound. An error or a timeout is compensated. A start that completes
  // after the timeout is stopped as soon as it lands, so no body runs uncounted; the abort signal
  // tells the adapter the caller has given up (the adapter removes the container on abort).
  async function startBody(spec: BodySpec): Promise<void> {
    const { playerName } = spec;
    const token = {};
    attempts.set(playerName, token);
    const controller = new AbortController();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve().then(() => deps.runtime.start(spec, controller.signal));
    const cutOff = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        reject(new Error('runtime call timed out'));
      }, timeoutMs);
    });
    try {
      await Promise.race([work, cutOff]);
    } catch (error) {
      if (expired) {
        void work.then(
          () => compensateLate(playerName, token),
          () => forgetAttempt(playerName, token),
        );
      } else {
        forgetAttempt(playerName, token);
      }
      await compensate(playerName);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    forgetAttempt(playerName, token);
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
    // Another owner's running body refuses the start. A stopped one does not: the roster owner may
    // start the name, and the adapter replaces the stopped container (C7-03b).
    if (record !== null && record.ownerId !== ownerId && record.running) {
      return outcome({ ok: false, code: 'unknown' }, admin);
    }
    // A repeat start while this owner's body runs is the same request again: it changes nothing
    // and counts nothing. A restart replaces the body.
    if (op === 'start' && record?.running && !uncounted.has(playerName)) {
      return repeatStart(admin);
    }
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
    // A Docker error or timeout throws here: no row is inserted, so the failed start does not count.
    await startBody({ ownerId, playerName, config: bodyContainerConfig() });
    const startOp = op === 'restart' ? 'restart' : 'start';
    try {
      await deps.starts.insert({ ownerId, playerName, op: startOp, at: deps.now() });
      uncounted.delete(playerName);
    } catch (error) {
      // The body is up but no row counts it: stop it, so no body runs uncounted, then report.
      await compensate(playerName);
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
    // A wrong owner, an unknown name and no body all get the same reply, and none of these count.
    // Stop needs only the body owner to be the caller: a body whose name left the roster stays
    // stoppable by its owner (orchestrator ruling, decision 0108).
    if (record === null || record.ownerId !== request.ownerId) {
      return outcome({ ok: false, code: 'unknown' }, admin);
    }
    if (request.op === 'stop') {
      await runtime.stop(request.playerName);
      return outcome({ ok: true, code: 'stopped' }, admin);
    }
    // Status and logtail also need the roster to name the caller.
    const rosterOwner = await deps.roster.ownerOfPlayer(request.playerName);
    if (rosterOwner !== request.ownerId) return outcome({ ok: false, code: 'unknown' }, admin);
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
      // Roster names are case-insensitive, so one body, one counter and one roster key serve
      // 'Ranger' and 'ranger' alike.
      const job = shaped ? { ...request, playerName: request.playerName.toLowerCase() } : null;
      const result = job
        ? await serialise(job.ownerId, () => attempt(job))
        : outcome({ ok: false, code: 'invalid' }, false);
      if (job && READ_ONLY_OPS.has(job.op)) return result.reply;
      const action = job ? `body_${job.op}` : 'body_invalid';
      try {
        await deps.audit.append({
          actor: job ? actorOf(job.ownerId) : 'invalid',
          action,
          target: job ? job.playerName : 'invalid',
          outcome: result.auditOutcome,
          admin: result.admin,
          detail: result.detail,
        });
      } catch (error) {
        // A start or stop that succeeded already changed the body: return its reply rather than an
        // error the caller would retry into a conflict. The lost row is signalled with a fixed code
        // only. A refusal changed nothing, so its audit failure throws and the caller gets no
        // unaudited reply.
        if (result.reply.ok) {
          try {
            deps.onAuditLost?.({ action, code: 'audit_lost' });
          } catch {
            // The hook is for logging; it must not change the reply.
          }
          return result.reply;
        }
        throw error;
      }
      return result.reply;
    },
  };
}

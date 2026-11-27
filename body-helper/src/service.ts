// The helper's four verbs. Every attempt writes one audit line (verb, name, outcome, a fixed reason):
// never the request body, never a template, never a secret. The start and stop verbs run one at a time (a
// promise chain), so the count a start reads is never stale: concurrent starts cannot pass the cap together.
// A refused start creates nothing, and a failed start leaves no container and reserves no slot. The verbs act
// only on a container that carries the helper's Body label; a container of the name without it is left alone.
import {
  admitConfig,
  admitName,
  type ManagedDbWiring,
  managedBodyConfig,
  removeConfig,
  removeName,
} from './managed-template.ts';
import { LOGIN_NAME, parseRequest } from './requests.ts';
import { LIFE_ID_PATTERN, type RosterLifePort } from './roster.ts';
import { type BodyTemplateInput, DEFAULT_NETWORK, DEFAULT_STACK } from './template.ts';

/** The count at which the helper writes one alert line (GLOBAL-CAP). */
export const CAP_ALERT_AT = 80;
export const CAP_REFUSAL = 'global body cap reached';
export const ALREADY_RUNNING = 'already running';
export const NAME_TAKEN = 'name taken by a container the helper did not create';
/** A stop, status or logtail of a Body that another owner holds (decision 0108: only the label owner acts on it). */
export const NOT_YOUR_BODY = 'not your body';
/** A start of a name whose Body another owner holds (a roster move). The Body is never removed or stopped by it. */
export const OTHER_OWNER_BODY = "name in use by another owner's body";
/** The reply for a start or stop that an Engine call held past its deadline (code `timeout`). */
export const ENGINE_TIMEOUT = 'engine timeout';
/** The refusal of a start while managed Bodies are off (GELDAR_MANAGED_BODIES) or not fully configured. */
export const MANAGED_REFUSAL = 'managed bodies are not enabled';
/** The refusal of a start whose life admission (the admit one-shot) did not exit 0. The reason is never sent. */
export const ADMIT_REFUSAL = 'life admission failed';
/** The refusal of a stop whose life removal (the remove one-shot, BH-5b) did not exit 0. The caller retries; nothing is erased. */
export const LIFE_REMOVAL_FAILED = 'life removal failed';
/** The most time one start or stop may hold the queue (config: GELDAR_BODY_HELPER_DEADLINE_MS). */
export const REQUEST_DEADLINE_MS = 120_000;
/** The error an abandoned run ends with. It is never sent: the caller was answered at the deadline. */
const ABANDONED = 'abandoned after deadline';
/** The audit reason of a late start whose Body could not be removed after one retry (the Body is left running). */
export const LATE_START_REMOVE_FAILED = 'late_start_remove_failed';

export interface ContainerState {
  id: string;
  running: boolean;
  /** True only when the container carries the helper's Body label: the helper created it. */
  helperBody: boolean;
  /** The `geldar.owner` label, or null when the container has none. */
  owner: string | null;
  /** The validated `geldar.life` label of a managed Body (BH-5a), or null when absent or not a managed life id. Optional so older fakes compile. */
  lifeId?: string | null;
  /** The exit code of a stopped or restarting container (BH-6 sweep reads it), or null. Optional so older fakes compile. */
  exitCode?: number | null;
  /** True when the container carries the managed label `geldar.managed` (BH-6). Optional so older fakes compile. */
  managed?: boolean;
}

export interface BodyEngine {
  inspect(name: string): Promise<ContainerState | null>;
  /** Running Body containers plus the sovereign host containers on the node. */
  countCounted(): Promise<number>;
  create(name: string, config: Record<string, unknown>): Promise<string>;
  start(id: string): Promise<void>;
  stop(name: string): Promise<void>;
  remove(id: string): Promise<void>;
  /**
   * Creates, starts and waits for a one-shot container, removes it, and returns its exit code. It never counts toward
   * the cap (its label is not the Body label). A create, start or wait failure throws.
   */
  runOneShot(name: string, config: Record<string, unknown>): Promise<number>;
  logs(name: string): Promise<string>;
}

/** The managed settings from the helper's root-only config. `enabled` is GELDAR_MANAGED_BODIES, off until the live check. */
export interface ManagedSettings {
  enabled: boolean;
  db?: ManagedDbWiring | undefined;
  /** A Docker host path to the root-only RCON password file the admit one-shot binds. */
  rconSecretHostPath?: string | undefined;
}

export type TemplateSettings = Omit<BodyTemplateInput, 'name' | 'owner' | 'loginName'> & {
  managed?: ManagedSettings;
};

/** What a managed start needs beyond the template: the validated life id, the database wiring and the RCON file. */
interface ManagedPlan {
  lifeId: string;
  db: ManagedDbWiring;
  rconSecretHostPath: string;
}

export interface HelperDeps {
  roster: RosterLifePort;
  engine: BodyEngine;
  /** The most running Bodies plus sovereign hosts a start may leave the node with (GLOBAL-CAP). */
  cap: number;
  template: TemplateSettings;
  /** The most time one start or stop may hold the queue. Defaults to REQUEST_DEADLINE_MS. */
  requestDeadlineMs?: number;
  /**
   * Container names whose stop timed out and is not yet confirmed. A stop adds its name at the deadline and removes it
   * when the Engine stop lands. The sweep reports the names that are still listed.
   */
  stopTimeouts?: Set<string>;
  /**
   * Container names of a late start that the helper could not remove (after one retry) and that still run. The helper
   * adds a name when that happens and clears it when a later inspect finds the container gone or a start is accepted.
   * The sweep reports the names that are still listed running.
   */
  orphanStarts?: Set<string>;
  audit(line: string): void;
}

export type Reply =
  | { ok: true; state: string; text?: string; owner?: string }
  | {
      ok: false;
      code: 'refused' | 'not_running' | 'capacity' | 'failed' | 'timeout';
      error: string;
    };

export type RequestHandler = (raw: unknown) => Promise<Reply>;

/** The remove one-shot for a life id (BH-5b): the add one-shot's fixed template in mode remove. Any failure is -1. */
export async function runLifeRemove(
  engine: Pick<BodyEngine, 'runOneShot'>,
  settings: Parameters<typeof createBodyHelper>[0]['template'],
  lifeId: string,
): Promise<number> {
  try {
    const rconSecretHostPath = settings.managed?.rconSecretHostPath;
    if (rconSecretHostPath === undefined) return -1;
    return await engine.runOneShot(
      removeName(lifeId),
      removeConfig({
        image: settings.image,
        uid: settings.wiring.uid,
        network: settings.wiring.network ?? DEFAULT_NETWORK,
        stack: settings.wiring.stack ?? DEFAULT_STACK,
        lifeId,
        rconSecretHostPath,
      }),
    );
  } catch {
    return -1;
  }
}

export function createBodyHelper(deps: HelperDeps): RequestHandler {
  let alerted = false;
  // Start and stop run after the previous one settles. A failed run does not stop the queue.
  // Each run also has a deadline, counted from when it starts. Past it the caller is answered ENGINE_TIMEOUT (code
  // `timeout`) and the queue moves on. The abandoned run keeps going only as far as `live()` allows: from the deadline
  // on it makes no create, start or stop, and it writes no audit line. Each await that can resume after the deadline is
  // followed by a live() check. A start that completes after the deadline removes its own container, and it counts
  // against the cap until its Engine calls settle (pendingStarts), so the queue never sees a slot free that is still taken.
  const deadlineMs = deps.requestDeadlineMs ?? REQUEST_DEADLINE_MS;
  let chain: Promise<unknown> = Promise.resolve();
  let pendingStarts = 0;
  const exclusive = (
    verb: string,
    name: string,
    work: (live: () => boolean) => Promise<Reply>,
    onExpire?: () => void,
  ): Promise<Reply> => {
    const bounded = (): Promise<Reply> => {
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<Reply>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          onExpire?.();
          deps.audit(`body-helper verb=${verb} name=${name} outcome=refused reason=engine_timeout`);
          resolve({ ok: false, code: 'timeout', error: ENGINE_TIMEOUT });
        }, deadlineMs);
      });
      return Promise.race([work(() => !expired), deadline]).finally(() => clearTimeout(timer));
    };
    const run = chain.then(bounded, bounded);
    chain = run.catch(() => undefined);
    return run;
  };
  const audit = (verb: string, name: string, outcome: string, reason?: string) =>
    deps.audit(
      `body-helper verb=${verb} name=${name} outcome=${outcome}${reason ? ` reason=${reason}` : ''}`,
    );

  // One alert line when the count first reaches CAP_ALERT_AT; the flag clears when it falls below.
  const observe = (count: number) => {
    if (count < CAP_ALERT_AT) {
      alerted = false;
      return;
    }
    if (alerted) return;
    alerted = true;
    deps.audit(`body-helper alert running=${count} threshold=${CAP_ALERT_AT}`);
  };

  // A container of the name that the helper did not create is never stopped, read or removed. A Body labelled for
  // another owner is not acted on either (decision 0108: the label owner acts on it, roster or not).
  const refuseNameTaken = (verb: string, name: string): Reply => {
    audit(verb, name, 'refused', 'name_taken');
    return { ok: false, code: 'refused', error: NAME_TAKEN };
  };
  const refuseNotYourBody = (verb: string, name: string): Reply => {
    audit(verb, name, 'refused', 'not_your_body');
    return { ok: false, code: 'refused', error: NOT_YOUR_BODY };
  };
  // The refusal for a verb that acts on an existing container, or null when the caller may act on it.
  const refusalFor = (
    verb: string,
    name: string,
    state: ContainerState | null,
    owner: string,
  ): Reply | null => {
    if (state === null) return null;
    if (!state.helperBody) return refuseNameTaken(verb, name);
    if (state.owner !== owner) return refuseNotYourBody(verb, name);
    return null;
  };
  // A read of the container. A container found gone is no longer an orphan.
  const inspectOf = async (container: string): Promise<ContainerState | null> => {
    const state = await deps.engine.inspect(container);
    if (state === null) deps.orphanStarts?.delete(container);
    return state;
  };
  // Undoes a late start's Body: one retry (the remove forces the delete), then the name is recorded as an orphan.
  const undoLateStart = async (id: string, name: string, container: string): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await deps.engine.remove(id);
        return;
      } catch {
        // Tried again below; after the second failure the orphan is recorded.
      }
    }
    deps.orphanStarts?.add(container);
    audit('start', name, 'failed', LATE_START_REMOVE_FAILED);
  };

  const handle: RequestHandler = async (raw) => {
    const parsed = parseRequest(raw);
    if (!parsed.ok) {
      audit('unknown', '-', 'refused', parsed.why.replace(/\s+/g, '_'));
      return { ok: false, code: 'refused', error: parsed.why };
    }
    const { verb, name, owner } = parsed;
    const container = name.toLowerCase();
    try {
      // Only start needs a roster row: it creates a Body under the exact-case login name. stop, status and logtail act
      // on the container that carries this owner's label, so a name that left the roster stays stoppable by its owner.
      if (verb === 'status') {
        const state = await inspectOf(container);
        const refusal = refusalFor(verb, name, state, owner);
        if (refusal) return refusal;
        audit(verb, name, 'accepted');
        // Past the refusal the label owner is the caller, so the reply names the owner the Body really holds.
        if (state === null) return { ok: true, state: 'absent' };
        return { ok: true, state: state.running ? 'running' : 'stopped', owner };
      }
      if (verb === 'logtail') {
        const refusal = refusalFor(verb, name, await inspectOf(container), owner);
        if (refusal) return refusal;
        const text = await deps.engine.logs(container);
        audit(verb, name, 'accepted');
        return { ok: true, state: 'logs', text };
      }
      if (verb === 'stop') {
        return await exclusive(
          verb,
          name,
          (live) => stop(container, name, owner, live),
          () => {
            deps.stopTimeouts?.add(container);
          },
        );
      }
      // A start is refused before any roster or Engine call while managed Bodies are off (the flag is off by default).
      const managed = deps.template.managed;
      if (!managed?.enabled || !managed.db || !managed.rconSecretHostPath) {
        audit(verb, name, 'refused', 'managed_off');
        return { ok: false, code: 'refused', error: MANAGED_REFUSAL };
      }
      const loginName = await deps.roster.displayName(owner, name);
      if (loginName === null || !LOGIN_NAME.test(loginName)) {
        audit(verb, name, 'refused', 'not_on_roster');
        return { ok: false, code: 'refused', error: 'not on roster' };
      }
      const lifeId = await deps.roster.lifeId(owner, name);
      if (lifeId === null || !LIFE_ID_PATTERN.test(lifeId)) {
        audit(verb, name, 'refused', 'not_on_roster');
        return { ok: false, code: 'refused', error: 'not on roster' };
      }
      const plan: ManagedPlan = {
        lifeId,
        db: managed.db,
        rconSecretHostPath: managed.rconSecretHostPath,
      };
      return await exclusive(verb, name, (live) =>
        start(container, name, owner, loginName, plan, live),
      );
    } catch {
      audit(verb, name, 'failed');
      return { ok: false, code: 'failed', error: 'docker call failed' };
    }
  };

  // The remove one-shot for a life id (BH-5b, shared with the BH-6 sweep). Any failure is -1.
  const runRemove = (lifeId: string): Promise<number> =>
    runLifeRemove(deps.engine, deps.template, lifeId);

  // A stop whose life removal failed is reported, never answered as stopped: the delete path then erases nothing.
  const removalFailed = (name: string): Reply => {
    audit('stop', name, 'failed', 'life_removal');
    return { ok: false, code: 'failed', error: LIFE_REMOVAL_FAILED };
  };

  async function stop(
    container: string,
    name: string,
    owner: string,
    live: () => boolean,
  ): Promise<Reply> {
    const state = await inspectOf(container);
    // The deadline passed while the inspect was held: the caller was told `timeout`, so nothing is stopped now.
    if (!live()) throw new Error(ABANDONED);
    if (state === null) {
      deps.stopTimeouts?.delete(container);
      // Race only: the container vanished between the status the supervisor read and this stop. The supervisor answers
      // unknown for an absent status and sends no stop, so a container lost earlier leaves its life id admitted with no
      // automatic cleanup built; the operator removes it by the exact-name remove one-shot (body-helper-node-steps.md).
      // The Body is gone, so its life id comes from the roster row (the stop runs before any erase). No row: nothing to remove.
      // With managed Bodies off or without the rcon file no Body could have been admitted, so the roster is not read and
      // the stop answers not_running as before (a failed remove here would block every account delete while off).
      const removal = deps.template.managed;
      if (removal?.enabled && removal.rconSecretHostPath) {
        const lifeId = await deps.roster.lifeId(owner, name);
        if (!live()) throw new Error(ABANDONED);
        if (lifeId !== null) {
          const code = await runRemove(lifeId);
          if (!live()) throw new Error(ABANDONED);
          if (code !== 0) return removalFailed(name);
        }
      }
      audit('stop', name, 'not_running');
      return { ok: false, code: 'not_running', error: 'not running' };
    }
    const refusal = refusalFor('stop', name, state, owner);
    if (refusal) return refusal;
    // Only a Body with a validated geldar.life label is managed. A house or Adam Body has none: it is stopped, nothing else.
    const managedLifeId = state.lifeId ?? null;
    try {
      await deps.engine.stop(container);
    } finally {
      deps.stopTimeouts?.delete(container);
    }
    if (managedLifeId !== null) {
      const code = await runRemove(managedLifeId);
      if (!live()) throw new Error(ABANDONED);
      if (code !== 0) return removalFailed(name);
    }
    // A stop that lands after its deadline was already answered with the timeout: it is not audited as accepted.
    if (live()) audit('stop', name, 'accepted');
    return { ok: true, state: 'stopped' };
  }

  // The admit one-shot's exit code, or -1 when the one-shot could not run or did not finish (fail closed).
  const runAdmit = async (plan: ManagedPlan): Promise<number> => {
    try {
      const settings = deps.template;
      return await deps.engine.runOneShot(
        admitName(plan.lifeId),
        admitConfig({
          image: settings.image,
          uid: settings.wiring.uid,
          network: settings.wiring.network ?? DEFAULT_NETWORK,
          stack: settings.wiring.stack ?? DEFAULT_STACK,
          lifeId: plan.lifeId,
          mode: 'add',
          rconSecretHostPath: plan.rconSecretHostPath,
        }),
      );
    } catch {
      return -1;
    }
  };

  async function start(
    container: string,
    name: string,
    owner: string,
    loginName: string,
    plan: ManagedPlan,
    live: () => boolean,
  ): Promise<Reply> {
    const existing = await inspectOf(container);
    if (!live()) throw new Error(ABANDONED);
    // A Body of this name that another owner holds (a roster move) is neither removed nor stopped: the start is refused.
    if (existing?.helperBody && existing.owner !== owner) {
      audit('start', name, 'refused', 'other_owner');
      return { ok: false, code: 'refused', error: OTHER_OWNER_BODY };
    }
    if (existing?.running) {
      audit('start', name, 'refused', 'already_running');
      return { ok: false, code: 'refused', error: ALREADY_RUNNING };
    }
    // A stopped container of the same name is removed only when the helper made it. Anything else is left alone.
    if (existing && !existing.helperBody) {
      audit('start', name, 'refused', 'name_taken');
      return { ok: false, code: 'refused', error: NAME_TAKEN };
    }
    const count = await deps.engine.countCounted();
    if (!live()) throw new Error(ABANDONED);
    observe(count);
    // A start still in flight past its deadline is not running yet, so the count misses it: pendingStarts holds its slot.
    if (count + pendingStarts >= deps.cap) {
      audit('start', name, 'capacity');
      return { ok: false, code: 'capacity', error: CAP_REFUSAL };
    }
    // The Body config is built before any Engine call, so a value the template refuses never starts an admit.
    const settings = deps.template;
    const config = managedBodyConfig({
      image: settings.image,
      wiring: settings.wiring,
      limits: settings.limits,
      name: container,
      owner,
      loginName,
      lifeId: plan.lifeId,
      db: plan.db,
    });
    pendingStarts++;
    try {
      // The admit one-shot runs before the Body is created. It is not counted (its label is geldar.admit).
      const code = await runAdmit(plan);
      if (!live()) throw new Error(ABANDONED);
      if (code !== 0) {
        audit('start', name, 'refused', 'admit_failed');
        return { ok: false, code: 'refused', error: ADMIT_REFUSAL };
      }
      if (existing) await deps.engine.remove(existing.id);
      if (!live()) throw new Error(ABANDONED);
      const id = await deps.engine.create(container, config);
      try {
        if (!live()) throw new Error(ABANDONED);
        await deps.engine.start(id);
      } catch (error) {
        await deps.engine.remove(id).catch(() => undefined);
        throw error;
      }
      // The start answered after the deadline: the caller was refused, so the Body is undone and nothing is accepted.
      if (!live()) {
        await undoLateStart(id, name, container);
        throw new Error(ABANDONED);
      }
      audit('start', name, 'accepted');
      deps.orphanStarts?.delete(container);
      // A start accepted now means no stop of this name still applies to a Body: the old one is gone.
      deps.stopTimeouts?.delete(container);
      return { ok: true, state: 'started' };
    } finally {
      pendingStarts--;
    }
  }

  return handle;
}

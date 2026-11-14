// The helper's four verbs. Every attempt writes one audit line (verb, name, outcome, a fixed reason):
// never the request body, never a template, never a secret. The start and stop verbs run one at a time (a
// promise chain), so the count a start reads is never stale: concurrent starts cannot pass the cap together.
// A refused start creates nothing, and a failed start leaves no container and reserves no slot. The verbs act
// only on a container that carries the helper's Body label; a container of the name without it is left alone.
import { LOGIN_NAME, parseRequest } from './requests.ts';
import type { RosterPort } from './roster.ts';
import { type BodyTemplateInput, bodyContainerConfig } from './template.ts';

/** The count at which the helper writes one alert line (GLOBAL-CAP). */
export const CAP_ALERT_AT = 30;
export const CAP_REFUSAL = 'global body cap reached';
export const ALREADY_RUNNING = 'already running';
export const NAME_TAKEN = 'name taken by a container the helper did not create';
/** The refusal for a start or stop that an Engine call held past its deadline. */
export const ENGINE_TIMEOUT = 'engine timeout';
/** The most time one start or stop may hold the queue (config: GELDAR_BODY_HELPER_DEADLINE_MS). */
export const REQUEST_DEADLINE_MS = 120_000;

export interface ContainerState {
  id: string;
  running: boolean;
  /** True only when the container carries the helper's Body label: the helper created it. */
  helperBody: boolean;
}

export interface BodyEngine {
  inspect(name: string): Promise<ContainerState | null>;
  /** Running Body containers plus the sovereign host containers on the node. */
  countCounted(): Promise<number>;
  create(name: string, config: Record<string, unknown>): Promise<string>;
  start(id: string): Promise<void>;
  stop(name: string): Promise<void>;
  remove(id: string): Promise<void>;
  logs(name: string): Promise<string>;
}

export type TemplateSettings = Omit<BodyTemplateInput, 'name' | 'owner' | 'loginName'>;

export interface HelperDeps {
  roster: RosterPort;
  engine: BodyEngine;
  /** The most running Bodies plus sovereign hosts a start may leave the node with (GLOBAL-CAP). */
  cap: number;
  template: TemplateSettings;
  /** The most time one start or stop may hold the queue. Defaults to REQUEST_DEADLINE_MS. */
  requestDeadlineMs?: number;
  audit(line: string): void;
}

export type Reply =
  | { ok: true; state: string; text?: string }
  | {
      ok: false;
      code: 'refused' | 'not_running' | 'capacity' | 'failed';
      error: string;
    };

export type RequestHandler = (raw: unknown) => Promise<Reply>;

export function createBodyHelper(deps: HelperDeps): RequestHandler {
  let alerted = false;
  // Start and stop run after the previous one settles. A failed run does not stop the queue.
  // Each run also has a deadline, counted from when it starts. Past it the caller is answered ENGINE_TIMEOUT and the
  // queue moves on. The abandoned run's `live()` turns false, so it creates or starts nothing after the deadline.
  const deadlineMs = deps.requestDeadlineMs ?? REQUEST_DEADLINE_MS;
  let chain: Promise<unknown> = Promise.resolve();
  const exclusive = (
    verb: string,
    name: string,
    work: (live: () => boolean) => Promise<Reply>,
  ): Promise<Reply> => {
    const bounded = (): Promise<Reply> => {
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<Reply>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          deps.audit(`body-helper verb=${verb} name=${name} outcome=refused reason=engine_timeout`);
          resolve({ ok: false, code: 'refused', error: ENGINE_TIMEOUT });
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

  // A container of the name that the helper did not create. The verbs never stop, read or remove it.
  const foreign = (state: ContainerState | null): boolean => state !== null && !state.helperBody;
  const refuseNameTaken = (verb: string, name: string): Reply => {
    audit(verb, name, 'refused', 'name_taken');
    return { ok: false, code: 'refused', error: NAME_TAKEN };
  };

  return async (raw) => {
    const parsed = parseRequest(raw);
    if (!parsed.ok) {
      audit('unknown', '-', 'refused', parsed.why.replace(/\s+/g, '_'));
      return { ok: false, code: 'refused', error: parsed.why };
    }
    const { verb, name, owner } = parsed;
    const container = name.toLowerCase();
    try {
      const loginName = await deps.roster.displayName(owner, name);
      if (loginName === null || !LOGIN_NAME.test(loginName)) {
        audit(verb, name, 'refused', 'not_on_roster');
        return { ok: false, code: 'refused', error: 'not on roster' };
      }
      if (verb === 'status') {
        const state = await deps.engine.inspect(container);
        if (foreign(state)) return refuseNameTaken(verb, name);
        audit(verb, name, 'accepted');
        return {
          ok: true,
          state: state === null ? 'absent' : state.running ? 'running' : 'stopped',
        };
      }
      if (verb === 'logtail') {
        if (foreign(await deps.engine.inspect(container))) return refuseNameTaken(verb, name);
        const text = await deps.engine.logs(container);
        audit(verb, name, 'accepted');
        return { ok: true, state: 'logs', text };
      }
      if (verb === 'stop') return await exclusive(verb, name, () => stop(container, name));
      return await exclusive(verb, name, (live) => start(container, name, owner, loginName, live));
    } catch {
      audit(verb, name, 'failed');
      return { ok: false, code: 'failed', error: 'docker call failed' };
    }
  };

  async function stop(container: string, name: string): Promise<Reply> {
    const state = await deps.engine.inspect(container);
    if (state === null) {
      audit('stop', name, 'not_running');
      return { ok: false, code: 'not_running', error: 'not running' };
    }
    if (foreign(state)) return refuseNameTaken('stop', name);
    await deps.engine.stop(container);
    audit('stop', name, 'accepted');
    return { ok: true, state: 'stopped' };
  }

  async function start(
    container: string,
    name: string,
    owner: string,
    loginName: string,
    live: () => boolean,
  ): Promise<Reply> {
    const existing = await deps.engine.inspect(container);
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
    observe(count);
    if (count >= deps.cap) {
      audit('start', name, 'capacity');
      return { ok: false, code: 'capacity', error: CAP_REFUSAL };
    }
    // An abandoned run (past its deadline) makes no further Engine mutation: the queue has moved on.
    if (!live()) throw new Error('abandoned after deadline');
    if (existing) await deps.engine.remove(existing.id);
    if (!live()) throw new Error('abandoned after deadline');
    const config = bodyContainerConfig({ ...deps.template, name: container, owner, loginName });
    const id = await deps.engine.create(container, config);
    try {
      if (!live()) throw new Error('abandoned after deadline');
      await deps.engine.start(id);
    } catch (error) {
      await deps.engine.remove(id).catch(() => undefined);
      throw error;
    }
    audit('start', name, 'accepted');
    return { ok: true, state: 'started' };
  }
}

// The helper's four verbs. Every attempt writes one audit line (verb, name, outcome, a fixed reason):
// never the request body, never a template, never a secret. The count of running Bodies is read before a
// start; a refused start creates nothing, and a failed start leaves no container and reserves no slot.
import { CAP_ENV, type GlobalCap } from './config.ts';
import { LOGIN_NAME, parseRequest } from './requests.ts';
import type { RosterPort } from './roster.ts';
import { type BodyTemplateInput, bodyContainerConfig } from './template.ts';

/** The count at which the helper writes one alert line (GLOBAL-CAP). */
export const CAP_ALERT_AT = 30;
export const CAP_REFUSAL = 'global body cap reached';
export const ALREADY_RUNNING = 'already running';
export const NAME_TAKEN = 'name taken by a container the helper did not create';

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
  cap: GlobalCap;
  template: TemplateSettings;
  audit(line: string): void;
}

export type Reply =
  | { ok: true; state: string; text?: string }
  | {
      ok: false;
      code: 'refused' | 'not_running' | 'capacity' | 'cap_config' | 'failed';
      error: string;
    };

export type RequestHandler = (raw: unknown) => Promise<Reply>;

export function createBodyHelper(deps: HelperDeps): RequestHandler {
  let alerted = false;
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
        audit(verb, name, 'accepted');
        return {
          ok: true,
          state: state === null ? 'absent' : state.running ? 'running' : 'stopped',
        };
      }
      if (verb === 'logtail') {
        const text = await deps.engine.logs(container);
        audit(verb, name, 'accepted');
        return { ok: true, state: 'logs', text };
      }
      if (verb === 'stop') {
        const state = await deps.engine.inspect(container);
        if (state === null) {
          audit(verb, name, 'not_running');
          return { ok: false, code: 'not_running', error: 'not running' };
        }
        await deps.engine.stop(container);
        audit(verb, name, 'accepted');
        return { ok: true, state: 'stopped' };
      }
      return await start(container, name, owner, loginName);
    } catch {
      audit(verb, name, 'failed');
      return { ok: false, code: 'failed', error: 'docker call failed' };
    }
  };

  async function start(
    container: string,
    name: string,
    owner: string,
    loginName: string,
  ): Promise<Reply> {
    const cap = deps.cap;
    if (!cap.ok) {
      audit('start', name, 'refused', 'cap_config');
      return { ok: false, code: 'cap_config', error: `${CAP_ENV} is invalid` };
    }
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
    if (count >= cap.cap) {
      audit('start', name, 'capacity');
      return { ok: false, code: 'capacity', error: CAP_REFUSAL };
    }
    if (existing) await deps.engine.remove(existing.id);
    const config = bodyContainerConfig({ ...deps.template, name: container, owner, loginName });
    const id = await deps.engine.create(container, config);
    try {
      await deps.engine.start(id);
    } catch (error) {
      await deps.engine.remove(id).catch(() => undefined);
      throw error;
    }
    audit('start', name, 'accepted');
    return { ok: true, state: 'started' };
  }
}

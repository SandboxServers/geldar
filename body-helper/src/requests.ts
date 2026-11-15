// The request the helper accepts over NATS: a verb and a roster name, and the owner the supervisor
// holds the name under (the definer function takes an owner, 0033). Any other field is refused, so a
// caller cannot pass an image, a mount, an env value, a flag or a command.

export const VERBS = ['start', 'stop', 'status', 'logtail'] as const;
export type Verb = (typeof VERBS)[number];

/** The Minecraft login name shape. The helper checks it itself, before any database call. */
export const LOGIN_NAME = /^[A-Za-z0-9_]{3,16}$/;

const FIELDS: readonly string[] = ['verb', 'name', 'owner'];
const OWNER_MAX = 64;

export type ParsedRequest =
  | { ok: true; verb: Verb; name: string; owner: string }
  | { ok: false; why: string };

export function parseRequest(raw: unknown): ParsedRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, why: 'request not an object' };
  }
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => !FIELDS.includes(key))) {
    return { ok: false, why: 'unexpected field' };
  }
  const verb = record.verb;
  if (typeof verb !== 'string' || !(VERBS as readonly string[]).includes(verb)) {
    return { ok: false, why: 'unknown verb' };
  }
  const name = record.name;
  if (typeof name !== 'string' || !LOGIN_NAME.test(name)) {
    return { ok: false, why: 'name outside the login shape' };
  }
  const owner = record.owner;
  if (typeof owner !== 'string' || owner === '' || owner.length > OWNER_MAX) {
    return { ok: false, why: 'owner missing' };
  }
  return { ok: true, verb: verb as Verb, name, owner };
}

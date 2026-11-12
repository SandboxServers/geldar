// Argument and URL validation for kino-shot. Pure: no browser, no network.

export type Mode = 'follow' | 'orbit' | 'free';

export interface ShotArgs {
  url: string;
  agent: string | null;
  mode: Mode;
  seconds: number;
  viewport: { width: number; height: number };
  out: string;
}

export const DEFAULT_OUT = '.claude/kino-shots';

const MODES: readonly Mode[] = ['follow', 'orbit', 'free'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Throws unless the URL is https, or http on localhost. */
export function validateUrl(raw: string | undefined): string {
  if (!raw) throw new Error('no URL: pass --url or set KINO_URL');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('the URL is not valid');
  }
  if (u.username || u.password) throw new Error('the URL must not carry credentials');
  if (u.protocol === 'https:') return u.href;
  if (u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname)) return u.href;
  throw new Error('the URL must be https (http only for localhost)');
}

function parseViewport(v: string): { width: number; height: number } {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(v);
  if (!m) throw new Error('--viewport must look like 430x900');
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (width < 200 || height < 200 || width > 4000 || height > 4000) {
    throw new Error('--viewport sides must be 200..4000');
  }
  return { width, height };
}

export function parseArgs(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): ShotArgs {
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--') continue;
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (!['url', 'agent', 'mode', 'seconds', 'viewport', 'out'].includes(key)) {
      throw new Error(`unknown option ${a}`);
    }
    const val = argv[++i];
    if (val === undefined || val.startsWith('--')) throw new Error(`${a} needs a value`);
    opts[key] = val;
  }
  const mode = (opts.mode ?? 'follow') as Mode;
  if (!MODES.includes(mode)) throw new Error('--mode must be follow, orbit or free');
  const seconds = opts.seconds === undefined ? 25 : Number(opts.seconds);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) {
    throw new Error('--seconds must be 1..300');
  }
  const agent = opts.agent ?? null;
  if (agent !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(agent))
    throw new Error('--agent is not a valid id');
  return {
    url: validateUrl(opts.url ?? env.KINO_URL),
    agent,
    mode,
    seconds,
    viewport: parseViewport(opts.viewport ?? '430x900'),
    out: opts.out ?? DEFAULT_OUT,
  };
}

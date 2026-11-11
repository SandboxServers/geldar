/**
 * Builds the Kino objects for Glass: kill switch, metrics, audit, relay, the OTLP exporter and the
 * static web app. Nothing here exists unless the owner enabled Kino (default off): `buildKino` is
 * called with a feed only then, and without one Glass has no Kino route, upgrade handler or page.
 */
import { readdirSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import type { Duplex } from 'node:stream';
import { kinoSessionFromHeader } from '../kino-cookie.ts';
import type { SqlClient } from '../query.ts';
import { KinoAudit, sqlAuditStore } from './audit.ts';
import { type ControlSink, controlledFeed } from './control.ts';
import { KinoKillSwitch } from './killswitch.ts';
import { KinoMetrics } from './metrics.ts';
import { startOtlpExporter } from './otlp.ts';
import { type FeedSource, KinoRelay } from './relay.ts';
import { ANONYMOUS, listAgents, sqlScopeStore, watchableIds } from './scope.ts';
import { handleKinoUpgrade } from './ws.ts';

const WEB = new URL('../../web/kino/', import.meta.url);
const THREE = new URL('../../node_modules/three/build/', import.meta.url);
const JS = 'text/javascript; charset=utf-8';
/** One day: the audit purge runs at start and then daily. */
const PURGE_MS = 86_400_000;

export interface KinoEnv {
  enabled: boolean;
  shard: string;
  natsUrl: string;
  otlpEndpoint: string | undefined;
}

/** Kino settings from the environment. `enabled` is true only for GELDAR_KINO_ENABLED=1 or true. */
export function loadKinoEnv(env: NodeJS.ProcessEnv = process.env): KinoEnv {
  const flag = (env.GELDAR_KINO_ENABLED ?? '').toLowerCase();
  return {
    enabled: flag === '1' || flag === 'true',
    shard: env.GELDAR_SHARD || 'phase0',
    natsUrl: env.GELDAR_NATS_URL || 'nats://nats:4222',
    otlpEndpoint: env.GELDAR_KINO_OTLP_ENDPOINT || undefined,
  };
}

/** Web files by URL path under /kino/: the page and the TypeScript modules, types stripped. */
function loadWeb(dir: URL, prefix: string, out: Map<string, { body: string; type: string }>): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(e.isDirectory() ? `${e.name}/` : e.name, dir);
    if (e.isDirectory()) loadWeb(child, `${prefix}${e.name}/`, out);
    else if (e.name.endsWith('.ts'))
      out.set(`${prefix}${e.name}`, {
        body: stripTypeScriptTypes(readFileSync(child, 'utf8')),
        type: JS,
      });
    else if (e.name.endsWith('.html'))
      out.set(e.name === 'index.html' ? prefix : `${prefix}${e.name}`, {
        body: readFileSync(child, 'utf8'),
        type: 'text/html; charset=utf-8',
      });
  }
}

export interface KinoParts {
  relay: KinoRelay;
  killSwitch: KinoKillSwitch;
  metrics: KinoMetrics;
  audit: KinoAudit;
  /** Serves /kino/ pages. Returns false for a path it does not own. */
  http(req: IncomingMessage, res: ServerResponse): boolean;
  upgrade(req: IncomingMessage, socket: Duplex): void;
  stop(): void;
}

export interface KinoWiringOptions {
  db: SqlClient;
  /** The feed; with a control sink Glass also asks the plugin to start and stop targets. */
  feed: FeedSource & { control?: ControlSink };
  sessionKey: string | undefined;
  /** Glass's own enabled flag (the Glass kill switch also ends Kino). */
  glassEnabled: () => boolean;
  otlpEndpoint?: string | undefined;
  /** Web files to serve; defaults to glass/web/kino. Tests pass none. */
  serveWeb?: boolean;
}

export function buildKino(o: KinoWiringOptions): KinoParts {
  const killSwitch = new KinoKillSwitch(true);
  const metrics = new KinoMetrics();
  const audit = new KinoAudit(sqlAuditStore(o.db), () =>
    console.log('{"kino":"audit write failed"}'),
  );
  const enabled = (): boolean => o.glassEnabled() && killSwitch.enabled();
  const control = o.feed.control;
  const feed = control ? controlledFeed(o.feed, { sink: control, enabled }) : o.feed;
  const relay = new KinoRelay({
    store: sqlScopeStore(o.db),
    feed,
    enabled,
    audit,
    onPanes: metrics.onPanes,
    onRefusal: metrics.onRefusal,
    onBytes: metrics.onBytes,
  });
  killSwitch.attach(relay);
  const stopOtlp = startOtlpExporter(metrics, { endpoint: o.otlpEndpoint });
  const purge = (): void => void audit.purge().catch(() => {});
  purge();
  const purgeTimer = setInterval(purge, PURGE_MS);
  purgeTimer.unref();
  const files = new Map<string, { body: string; type: string }>();
  if (o.serveWeb !== false) {
    loadWeb(WEB, '/kino/', files);
    for (const name of ['three.module.js', 'three.core.js'])
      files.set(`/kino/vendor/${name}`, {
        body: readFileSync(new URL(name, THREE), 'utf8'),
        type: JS,
      });
  }
  /** The picker's list: who is signed in and which agents the server lets this viewer watch. */
  const targets = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const json = (code: number, body: unknown): void => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') return void res.writeHead(405, { Allow: 'GET' }).end();
    if (!enabled()) return json(200, { signed_in: false, enabled: false, agents: [] });
    try {
      const session =
        o.sessionKey === undefined
          ? null
          : kinoSessionFromHeader(o.sessionKey, req.headers.cookie, Date.now());
      const access = session ? await sqlScopeStore(o.db).access(session.identityHash) : ANONYMOUS;
      json(200, {
        signed_in: access.signedIn,
        enabled: true,
        agents: watchableIds(access, await listAgents(o.db)),
      });
    } catch {
      json(503, { error: 'unavailable' });
    }
  };
  return {
    relay,
    killSwitch,
    metrics,
    audit,
    http(req, res) {
      const path = (req.url ?? '').split('?')[0] ?? '';
      if (path === '/kino/targets') {
        void targets(req, res);
        return true;
      }
      const file = files.get(path);
      if (file === undefined) return false;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return true;
      }
      res.writeHead(200, { 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
      res.end(file.body);
      return true;
    },
    upgrade(req, socket) {
      const route = { relay, sessionKey: o.sessionKey, now: () => Date.now() };
      if (!handleKinoUpgrade(route, req, socket)) socket.destroy();
    },
    stop() {
      clearInterval(purgeTimer);
      if (control) (feed as { dispose?: () => void }).dispose?.();
      stopOtlp?.();
      killSwitch.set(false);
    },
  };
}

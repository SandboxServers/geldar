/**
 * A minimal RFC 6455 server for the Kino route: text frames in (small, masked, unfragmented), text
 * frames out. Glass has no WebSocket dependency and the import graph allows none, so this is the
 * whole protocol the relay needs. Any frame it does not understand closes the socket.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { clientAddress, clientKey } from '../guard.ts';
import { kinoSessionFromHeader } from '../kino-cookie.ts';
import { normalizeOrigin } from './origins.ts';
import type { KinoRelay, Pane } from './relay.ts';

export const KINO_WS_PATH = '/kino/ws';
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
/** A client message is a few dozen bytes; this is generous and bounds memory. */
const MAX_FRAME = 1024;
/** A client that lets this much feed queue up unread is dropped (a slow reader must not grow Glass's heap). */
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
/** A client whose queue does not move for this long is dropped. */
export const STALL_MS = 30_000;
/** Pending commands per connection before it is dropped. */
const MAX_QUEUED_MESSAGES = 16;

export function encodeText(text: string): Buffer {
  const body = Buffer.from(text, 'utf8');
  const head =
    body.length < 126
      ? Buffer.from([0x81, body.length])
      : body.length < 65536
        ? Buffer.from([0x81, 126, body.length >> 8, body.length & 255])
        : (() => {
            const h = Buffer.alloc(10);
            h[0] = 0x81;
            h[1] = 127;
            h.writeBigUInt64BE(BigInt(body.length), 2);
            return h;
          })();
  return Buffer.concat([head, body]);
}

/** Pulls whole client frames off `buf`. Returns the rest, or null for a protocol violation. */
export function decodeFrames(
  buf: Buffer,
  onText: (t: string) => void,
  onControl: (op: number) => void,
): Buffer | null {
  let rest = buf;
  while (rest.length >= 2) {
    const b0 = rest[0] as number;
    const b1 = rest[1] as number;
    const op = b0 & 15;
    if ((b0 & 0x80) === 0 || (b0 & 0x70) !== 0 || (b1 & 0x80) === 0) return null;
    let len = b1 & 127;
    let off = 2;
    if (len === 126) {
      if (rest.length < 4) break;
      len = rest.readUInt16BE(2);
      off = 4;
    } else if (len === 127) return null;
    if (len > MAX_FRAME) return null;
    if (rest.length < off + 4 + len) break;
    const mask = rest.subarray(off, off + 4);
    const data = Buffer.from(rest.subarray(off + 4, off + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] = (data[i] as number) ^ (mask[i % 4] as number);
    if (op === 1) onText(data.toString('utf8'));
    else if (op === 8 || op === 9 || op === 10) onControl(op);
    else return null;
    rest = rest.subarray(off + 4 + len);
  }
  return rest;
}

export interface WsRoute {
  relay: KinoRelay;
  sessionKey: string | undefined;
  now: () => number;
  /** Peers whose x-geldar-client-ip is believed (GELDAR_GLASS_TRUSTED_PROXIES). */
  trustedProxies?: ReadonlySet<string>;
  /** Full origins allowed on the upgrade (GELDAR_KINO_ALLOWED_ORIGINS). */
  allowedOrigins?: readonly string[];
  maxBuffered?: number;
  stallMs?: number;
}

/**
 * A browser's Origin must be on the explicit allow-list (GELDAR_KINO_ALLOWED_ORIGINS, full origins such as
 * https://glass.example.test). There is no comparison with the Host header: Caddy rewrites Host to localhost
 * for /kino, so Host says nothing about the page that opened the socket.
 * A request with no Origin header is not a browser page (browsers always send one on a WebSocket upgrade),
 * so no cross-site script can ride the cookie through it; it stays allowed.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true;
  const o = normalizeOrigin(origin);
  return o !== null && allowed.some((a) => normalizeOrigin(a) === o);
}
/** Handles an `upgrade` event for KINO_WS_PATH. Returns false when the path is not ours. */
export function handleKinoUpgrade(route: WsRoute, req: IncomingMessage, socket: Duplex): boolean {
  if (new URL(req.url ?? '/', 'http://x').pathname !== KINO_WS_PATH) return false;
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return true;
  }
  if (!originAllowed(req.headers.origin, route.allowedOrigins ?? [])) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return true;
  }
  const accept = createHash('sha1')
    .update(key + GUID)
    .digest('base64');
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const session =
    route.sessionKey === undefined
      ? null
      : kinoSessionFromHeader(route.sessionKey, req.headers.cookie, route.now());
  const client = clientKey(clientAddress(req, route.trustedProxies ?? new Set()));
  const maxBuffered = route.maxBuffered ?? MAX_BUFFERED_BYTES;
  let ended = false;
  let dropping = false;
  let pane: Pane | null = null;
  const conn = {
    send: (t: string) => {
      if (ended || !socket.writable) return;
      const frame = encodeText(t);
      if (!dropping && socket.writableLength + frame.length > maxBuffered) {
        // A slow reader: say bye, close, and destroy the socket if it still does not drain.
        dropping = true;
        if (pane !== null) pane.overloaded();
        else conn.close();
        setTimeout(() => socket.destroy(), 2000).unref();
        return;
      }
      socket.write(frame);
    },
    close: () => {
      if (ended) return;
      ended = true;
      socket.end(Buffer.from([0x88, 0]));
    },
  };
  pane = route.relay.accept(
    conn,
    session?.identityHash ?? `anon:${client}`,
    session?.identityHash ?? null,
    session === null ? {} : { expiresAt: session.expiresAt },
  );
  if (pane === null) return true;
  const live: Pane = pane;
  let pending: Buffer = Buffer.alloc(0);
  let chain: Promise<void> = Promise.resolve();
  let queued = 0;
  const fail = (): void => {
    live.closed();
    conn.close();
    socket.destroy();
  };
  const sock = socket as Duplex & { bytesWritten?: number };
  let lastWritten = sock.bytesWritten ?? 0;
  let stalledSince = 0;
  const stall = setInterval(() => {
    const written = sock.bytesWritten ?? 0;
    if (socket.writableLength === 0 || written !== lastWritten) stalledSince = 0;
    else if (stalledSince === 0) stalledSince = route.now();
    else if (route.now() - stalledSince >= (route.stallMs ?? STALL_MS)) {
      stalledSince = 0;
      dropping = true;
      live.overloaded();
      socket.destroy();
    }
    lastWritten = written;
  }, 1000);
  stall.unref();
  socket.on('close', () => clearInterval(stall));
  socket.on('data', (chunk: Buffer) => {
    const rest = decodeFrames(
      Buffer.concat([pending, chunk]),
      (t) => {
        if (queued >= MAX_QUEUED_MESSAGES) return fail();
        queued += 1;
        chain = chain
          .then(() => live.message(t))
          .catch(fail)
          .finally(() => {
            queued -= 1;
          });
      },
      (op) => {
        if (op === 8) fail();
        else if (op === 9 && socket.writable) socket.write(Buffer.from([0x8a, 0]));
      },
    );
    if (rest === null) fail();
    else pending = rest;
  });
  socket.on('close', () => live.closed());
  socket.on('error', fail);
  socket.on('end', fail);
  return true;
}

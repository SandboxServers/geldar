// The Kino page without a shard: serves glass/web/kino (types stripped, as Glass does), an invented
// textures.json and skins, a /kino/targets list, and a /kino/ws feed of the invented world with three
// walking agents. Test-only, loopback only, never deployed. Nothing here is Glass's real relay.
//
//   node glass/test/kino-preview/server.ts [port] [web-dir]     # default 8789, glass/web/kino
//
// The page's real CSP is not applied here (the preview's textures are served by this server).

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { join, relative, resolve } from 'node:path';
import type { Duplex } from 'node:stream';
import type { KinoFeed } from '../../../contract/src/generated/types.ts';
import { AGENTS, entityPositions, sectionMessages, skinPng, texturesJson } from './world.ts';

const HERE = import.meta.dirname;
const THREE = resolve(HERE, '../../node_modules/three/build');
const TICK_MS = 100;

interface File {
  body: Uint8Array | string;
  type: string;
}

function loadWeb(dir: string): Map<string, File> {
  const out = new Map<string, File>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      const rel = `/kino/${relative(dir, p).split('\\').join('/')}`;
      if (name.endsWith('.ts'))
        out.set(rel, {
          body: stripTypeScriptTypes(readFileSync(p, 'utf8')),
          type: 'text/javascript',
        });
      else if (name.endsWith('.html'))
        out.set(name === 'index.html' ? rel.replace(/index\.html$/, '') : rel, {
          body: readFileSync(p, 'utf8'),
          type: 'text/html; charset=utf-8',
        });
      else if (name.endsWith('.css'))
        out.set(rel, { body: readFileSync(p, 'utf8'), type: 'text/css; charset=utf-8' });
    }
  };
  walk(dir);
  for (const n of ['three.module.js', 'three.core.js'])
    out.set(`/kino/vendor/${n}`, {
      body: readFileSync(join(THREE, n), 'utf8'),
      type: 'text/javascript',
    });
  out.set('/kino/tex/maps/overworld/textures.json', {
    body: JSON.stringify(texturesJson()),
    type: 'application/json',
  });
  for (const a of AGENTS)
    out.set(`/kino/skins/${a.id}.png`, { body: skinPng(a), type: 'image/png' });
  return out;
}

/** One unmasked text frame, server to browser. */
function frame(text: string): Buffer {
  const data = Buffer.from(text);
  const n = data.length;
  let head: Buffer;
  if (n < 126) head = Buffer.from([0x81, n]);
  else if (n < 65536) head = Buffer.from([0x81, 126, n >> 8, n & 255]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, data]);
}

/** Masked browser frames: yields each complete text payload; returns the unread remainder. */
function readFrames(buf: Buffer, onText: (t: string) => void, onClose: () => void): Buffer {
  let off = 0;
  while (buf.length - off >= 2) {
    const op = (buf[off] as number) & 15;
    let len = (buf[off + 1] as number) & 127;
    let p = off + 2;
    if (len === 126) {
      if (buf.length < p + 2) break;
      len = buf.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (buf.length < p + 8) break;
      len = Number(buf.readBigUInt64BE(p));
      p += 8;
    }
    if (buf.length < p + 4 + len) break;
    const mask = buf.subarray(p, p + 4);
    const data = Buffer.from(buf.subarray(p + 4, p + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] = (data[i] as number) ^ (mask[i % 4] as number);
    if (op === 8) onClose();
    if (op === 1) onText(data.toString('utf8'));
    off = p + 4 + len;
  }
  return buf.subarray(off);
}

const SECTIONS = sectionMessages();
const START = Date.now();

function feed(socket: Duplex, key: string): void {
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${createHash(
      'sha1',
    )
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64')}\r\n\r\n`,
  );
  const send = (m: KinoFeed): void => void socket.write(frame(JSON.stringify(m)));
  let target: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  const stop = (): void => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  let rest: Buffer = Buffer.alloc(0);
  socket.on('data', (d: Buffer) => {
    rest = readFrames(
      Buffer.concat([rest, d]),
      (text) => {
        const msg = JSON.parse(text) as { type: string; target_agent_id?: string };
        if (msg.type === 'unsubscribe') return stop();
        if (msg.type !== 'subscribe' || msg.target_agent_id === target) return;
        target = msg.target_agent_id ?? null;
        const agent = AGENTS.find((a) => a.id === target);
        if (!agent) {
          send({ type: 'bye', reason: 'target_not_permitted' });
          return void socket.end();
        }
        stop();
        send({
          type: 'hello',
          feed_version: 1,
          world: 'world',
          target_agent_id: agent.id,
          view_radius: 3,
        });
        for (const s of SECTIONS) send(s);
        timer = setInterval(() => {
          const t = (Date.now() - START) / 1000;
          const entities = entityPositions(t);
          send({ type: 'entity_positions', entities });
          const me = entities.find((e) => e.agent_id === agent.id);
          if (me)
            send({ type: 'target_moved', target_agent_id: agent.id, x: me.x, y: me.y, z: me.z });
        }, TICK_MS);
      },
      () => socket.end(),
    );
  });
  socket.on('close', stop);
  socket.on('error', stop);
}

export function startPreview(port: number, webDir: string): Server {
  const files = loadWeb(webDir);
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (path === '/' || path === '/kino')
      return void res.writeHead(302, { Location: '/kino/' }).end();
    if (path === '/kino/targets') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return void res.end(
        JSON.stringify({
          enabled: true,
          signed_in: true,
          agents: AGENTS.map((a) => ({ id: a.id, label: a.label })),
        }),
      );
    }
    const f = files.get(path);
    if (!f) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'no-store' });
    res.end(f.body);
  });
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (req.url !== '/kino/ws' || typeof key !== 'string') return void socket.destroy();
    feed(socket, key);
  });
  server.listen(port, '127.0.0.1');
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(HERE, 'server.ts')) {
  const port = Number(process.argv[2] ?? 8789);
  const web = resolve(process.argv[3] ?? resolve(HERE, '../../web/kino'));
  startPreview(port, web);
  console.log(`Kino preview on http://127.0.0.1:${port}/kino/ (web: ${web})`);
}

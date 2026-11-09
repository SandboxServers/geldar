// Login probe for the Phase 0 forwarding wall (spec 5.1).
// This is a manual evidence tool: CI and ./geldar.ps1 check do not run it. It always exits 0 by
// design, so read the printed answer rather than the exit code. Run it on the compose network, for example:
//   docker run --rm --network geldar-phase0_default -v <this dir>:/probe:ro node:24-alpine \
//     node /probe/login-probe.mjs paper 25565 bad-hmac
// Arguments: host, port, mode. Modes: bad-hmac (Velocity data with an all-zero HMAC),
// not-understood (plugin response with success=false), velocity (answer nothing; a Velocity
// front end answers Paper itself). Holds no secrets. Prints the server's answer and exits.
// CONTINUE=1 goes past Login Success: Login Acknowledged, then the configuration phase
// (known packs, finish configuration) into play, where a kick reason is printed. HOLD_MS
// keeps the session open after that; IDLE_MS sets the no-data timeout (default 15 s).

import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { inflateSync } from 'node:zlib';

const [host, portArg, mode = 'bad-hmac'] = process.argv.slice(2);
const PROTOCOL = 775;
const LOGIN_START = 0x00;
const LOGIN_DISCONNECT = 0x00;
const LOGIN_SUCCESS = 0x02;
const LOGIN_PLUGIN_REQUEST = 0x04;
const LOGIN_PLUGIN_RESPONSE = 0x02;
const LOGIN_ACKNOWLEDGED = 0x03;
const SET_COMPRESSION = 0x03;
const ENCRYPTION_REQUEST = 0x01;
// Configuration phase (protocol 775), clientbound and serverbound ids.
const CFG_DISCONNECT = 0x02;
const CFG_FINISH = 0x03;
const CFG_KEEP_ALIVE = 0x04;
const CFG_PING = 0x05;
const CFG_KNOWN_PACKS = 0x0e;
const CFG_FINISH_ACK = 0x03;
const CFG_KEEP_ALIVE_ACK = 0x04;
const CFG_PONG = 0x05;
const CFG_KNOWN_PACKS_ACK = 0x07;
const CONTINUE = process.env.CONTINUE === '1';
let phase = 'login';

function varInt(value) {
  const out = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function readVarInt(buf, offset) {
  let value = 0;
  let shift = 0;
  let i = offset;
  let b;
  do {
    if (i >= buf.length) return null;
    b = buf[i++];
    value |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return { value, next: i };
}

function mcString(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([varInt(b.length), b]);
}

// Uncompressed framing: length, then id and body.
function plainPacket(id, body) {
  const payload = Buffer.concat([varInt(id), body]);
  return Buffer.concat([varInt(payload.length), payload]);
}

let threshold = -1;
let pending = Buffer.alloc(0);

// Sends a packet, using the compressed framing (data length 0) once Set Compression has arrived.
function send(sock, id, body) {
  let payload = Buffer.concat([varInt(id), body]);
  if (threshold >= 0) payload = Buffer.concat([varInt(0), payload]);
  sock.write(Buffer.concat([varInt(payload.length), payload]));
}

function nextPacket() {
  const len = readVarInt(pending, 0);
  if (!len || pending.length < len.next + len.value) return null;
  let body = pending.subarray(len.next, len.next + len.value);
  pending = pending.subarray(len.next + len.value);
  if (threshold >= 0) {
    const dataLen = readVarInt(body, 0);
    const rest = body.subarray(dataLen.next);
    body = dataLen.value > 0 ? inflateSync(rest) : rest;
  }
  const id = readVarInt(body, 0);
  return { id: id.value, data: body.subarray(id.next) };
}

function finish(sock, text) {
  console.log(`[${mode}] ${text}`);
  sock.destroy();
  process.exit(0);
}

const sock = net.connect(Number(portArg), host);
sock.setTimeout(Number(process.env.IDLE_MS ?? 15000), () =>
  finish(sock, 'no answer within the idle timeout'),
);

sock.on('connect', () => {
  const portBuf = Buffer.alloc(2);
  portBuf.writeUInt16BE(Number(portArg));
  const handshake = Buffer.concat([varInt(PROTOCOL), mcString(host), portBuf, varInt(2)]);
  sock.write(plainPacket(0x00, handshake));
  const name = Buffer.from('probe_bot', 'utf8');
  const uuid = Buffer.from(randomUUID().replace(/-/g, ''), 'hex');
  sock.write(plainPacket(LOGIN_START, Buffer.concat([varInt(name.length), name, uuid])));
});

sock.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  for (let p = nextPacket(); p; p = nextPacket()) {
    if (phase !== 'login') {
      handlePostLogin(sock, p);
      continue;
    }
    if (p.id === SET_COMPRESSION) {
      threshold = readVarInt(p.data, 0).value;
      console.log(`[${mode}] set compression threshold ${threshold}`);
    } else if (p.id === LOGIN_PLUGIN_REQUEST) {
      const msg = readVarInt(p.data, 0);
      const chLen = readVarInt(p.data, msg.next);
      const channel = p.data.subarray(chLen.next, chLen.next + chLen.value).toString('utf8');
      console.log(`[${mode}] plugin request ${channel}`);
      if (mode === 'velocity') continue;
      const id = varInt(msg.value);
      if (channel === 'velocity:player_info' && mode === 'bad-hmac') {
        // Success with a 32-byte HMAC of zeros and the version byte: Paper's check must reject it.
        send(
          sock,
          LOGIN_PLUGIN_RESPONSE,
          Buffer.concat([id, Buffer.from([1]), Buffer.alloc(32), varInt(1)]),
        );
      } else {
        send(sock, LOGIN_PLUGIN_RESPONSE, Buffer.concat([id, Buffer.from([0])]));
      }
    } else if (p.id === LOGIN_DISCONNECT) {
      finish(sock, `disconnect: ${readString(p.data)}`);
    } else if (p.id === LOGIN_SUCCESS) {
      if (CONTINUE) {
        console.log(`[${mode}] login success; sending login acknowledged`);
        send(sock, LOGIN_ACKNOWLEDGED, Buffer.alloc(0));
        phase = 'config';
        continue;
      }
      // HOLD_MS keeps the session open so the server's player list can be read meanwhile.
      setTimeout(() => finish(sock, 'login success'), Number(process.env.HOLD_MS ?? 0));
    } else if (p.id === ENCRYPTION_REQUEST) {
      finish(sock, 'encryption request (server is in online mode)');
    } else {
      console.log(`[${mode}] packet id ${p.id}`);
    }
  }
});

sock.on('close', () => finish(sock, 'connection closed by server'));
sock.on('error', (err) => finish(sock, `socket error: ${err.message}`));

// Configuration and play: finish the configuration phase, then hold in play for HOLD_MS.
function handlePostLogin(sock, p) {
  if (phase === 'config') {
    if (p.id === CFG_DISCONNECT) {
      finish(sock, `configuration disconnect: ${printable(p.data)}`);
    } else if (p.id === CFG_FINISH) {
      send(sock, CFG_FINISH_ACK, Buffer.alloc(0));
      phase = 'play';
      console.log(`[${mode}] configuration finished; entering play`);
      setTimeout(
        () => finish(sock, `play held, ${playPackets} play packets received`),
        Number(process.env.HOLD_MS ?? 0),
      );
    } else if (p.id === CFG_KNOWN_PACKS) {
      // Empty known-packs list: the server sends every registry entry.
      send(sock, CFG_KNOWN_PACKS_ACK, varInt(0));
    } else if (p.id === CFG_KEEP_ALIVE) {
      send(sock, CFG_KEEP_ALIVE_ACK, p.data.subarray(0, 8));
    } else if (p.id === CFG_PING) {
      send(sock, CFG_PONG, p.data.subarray(0, 4));
    } else {
      console.log(`[${mode}] configuration packet id ${p.id}`);
    }
    return;
  }
  // Play phase: count the packets (the world streams many) and report the first one.
  playPackets += 1;
  if (playPackets === 1) console.log(`[${mode}] first play packet id ${p.id}`);
}

let playPackets = 0;

// Printable ASCII of a buffer, for reading kick reasons out of NBT text components.
function printable(data) {
  return data
    .toString('utf8')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .trim();
}

function readString(data) {
  const len = readVarInt(data, 0);
  return data.subarray(len.next, len.next + len.value).toString('utf8');
}

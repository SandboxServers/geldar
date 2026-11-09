// Login probe for the Phase 0 forwarding wall (spec 5.1). Run it on the compose network, for example:
//   docker run --rm --network geldar-phase0_default -v <this dir>:/probe:ro node:24-alpine \
//     node /probe/login-probe.mjs paper 25565 bad-hmac
// Arguments: host, port, mode. Modes: bad-hmac (Velocity data with an all-zero HMAC),
// not-understood (plugin response with success=false), velocity (answer nothing; a Velocity
// front end answers Paper itself). Holds no secrets. Prints the server's answer and exits.

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
const SET_COMPRESSION = 0x03;
const ENCRYPTION_REQUEST = 0x01;

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
sock.setTimeout(15000, () => finish(sock, 'no answer within 15 s'));

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

function readString(data) {
  const len = readVarInt(data, 0);
  return data.subarray(len.next, len.next + len.value).toString('utf8');
}

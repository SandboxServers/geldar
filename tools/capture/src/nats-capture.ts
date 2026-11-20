#!/usr/bin/env node
// CAP-1: a NATS subscriber for the provenance capture session. It subscribes, prints READY on stdout, and writes every
// message it hears, byte for byte, to the output directory. Usage and the READY handshake: tools/capture/README.md.
import { connectNats } from '@geldar/contract/nats';
import { parseCaptureArgs, writeCapture } from './capture-files.ts';

async function main(): Promise<number> {
  let args: ReturnType<typeof parseCaptureArgs>;
  try {
    args = parseCaptureArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`nats-capture: ${(error as Error).message}\n`);
    return 2;
  }
  const nc = await connectNats({ name: 'geldar-capture', servers: args.url });
  let seq = 0;
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    nc.drain().catch((error: unknown) =>
      process.stderr.write(`nats-capture: drain: ${String(error)}\n`),
    );
  };
  const pumps = args.subjects.map(async (subject) => {
    const sub = nc.subscribe(subject);
    for await (const msg of sub) {
      seq += 1;
      try {
        writeCapture(args.out, seq, msg.subject, msg.data, new Date());
      } catch (error) {
        process.stderr.write(`nats-capture: write failed for seq ${seq}: ${String(error)}\n`);
        stop();
        return;
      }
      process.stderr.write(`captured ${seq} ${msg.subject} ${msg.data.byteLength} bytes\n`);
    }
  });
  // Every subscription is on the server before READY: a provenance message sent after READY is not lost (runbook).
  await nc.flush();
  process.stdout.write('READY\n');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (args.durationSeconds !== null) setTimeout(stop, args.durationSeconds * 1000);
  await Promise.all(pumps);
  await nc.close();
  process.stderr.write(`wrote ${seq} message(s) to ${args.out}\n`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`nats-capture: ${String(error)}\n`);
    process.exitCode = 2;
  },
);

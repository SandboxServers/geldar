import type { PlanKv } from './plan-store.ts';

/** The NATS server's default `max_payload`: a KV value above it is refused by the server. */
export const SERVER_MAX_PAYLOAD = 1024 * 1024;

export interface FakePlanKvOptions {
  /** The next N puts reject before writing. */
  failPuts?: number;
  /** The next N gets reject. */
  failGets?: number;
  /** The next N deletes reject before removing. */
  failDeletes?: number;
}

/** An in-memory bucket with fault counters and the server's value cap. */
export interface FakePlanKv extends PlanKv {
  readonly data: Map<string, string>;
  puts: number;
  deletes: number;
  /** The largest value any put tried to store, in UTF-8 bytes. */
  largestPut: number;
  failPuts: number;
  failGets: number;
  failDeletes: number;
}

/** A fake of the plan bucket: values over `SERVER_MAX_PAYLOAD` are refused, as the server does. */
export function fakePlanKv(options: FakePlanKvOptions = {}): FakePlanKv {
  const kv: FakePlanKv = {
    data: new Map<string, string>(),
    puts: 0,
    deletes: 0,
    largestPut: 0,
    failPuts: options.failPuts ?? 0,
    failGets: options.failGets ?? 0,
    failDeletes: options.failDeletes ?? 0,
    async put(key, value) {
      kv.puts++;
      if (kv.failPuts > 0) {
        kv.failPuts--;
        throw new Error('put refused by fake');
      }
      const bytes = Buffer.byteLength(value, 'utf8');
      kv.largestPut = Math.max(kv.largestPut, bytes);
      if (bytes > SERVER_MAX_PAYLOAD) throw new Error('max payload exceeded');
      kv.data.set(key, value);
      return kv.data.size;
    },
    async get(key) {
      if (kv.failGets > 0) {
        kv.failGets--;
        throw new Error('get refused by fake');
      }
      return kv.data.get(key) ?? null;
    },
    async delete(key) {
      kv.deletes++;
      if (kv.failDeletes > 0) {
        kv.failDeletes--;
        throw new Error('delete refused by fake');
      }
      kv.data.delete(key);
    },
  };
  return kv;
}

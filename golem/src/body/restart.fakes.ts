import type { BodyKv, KvRecord } from './checkpoint.ts';

/** An in-memory bucket with revisions, so `create` and `update` conflict as JetStream's do. */
export interface FakeKv extends BodyKv {
  /** The live value of `key`, or undefined. */
  peek(key: string): string | undefined;
  /** Makes the next `n` calls of `put` reject. */
  failPuts(n: number): void;
  /** Writes `key` directly, as another process would. */
  seed(key: string, value: string): void;
  puts: number;
}

/** `gap` makes every `get` yield once after reading, so two racing callers see the same revision. */
export function fakeKv(opts: { gap?: boolean } = {}): FakeKv {
  const data = new Map<string, KvRecord>();
  let revision = 0;
  let failing = 0;
  const write = (key: string, value: string): number => {
    revision += 1;
    data.set(key, { value, revision });
    return revision;
  };
  const kv: FakeKv = {
    puts: 0,
    peek: (key) => data.get(key)?.value,
    failPuts: (n) => {
      failing = n;
    },
    seed: (key, value) => {
      write(key, value);
    },
    async get(key) {
      const record = data.get(key);
      const copy = record ? { ...record } : null;
      if (opts.gap) await Promise.resolve();
      return copy;
    },
    async create(key, value) {
      if (data.has(key)) throw new Error('wrong last sequence');
      return write(key, value);
    },
    async update(key, value, expected) {
      if (data.get(key)?.revision !== expected) throw new Error('wrong last sequence');
      return write(key, value);
    },
    async put(key, value) {
      kv.puts += 1;
      if (failing > 0) {
        failing -= 1;
        throw new Error('bucket unavailable');
      }
      return write(key, value);
    },
    async delete(key) {
      data.delete(key);
    },
  };
  return kv;
}

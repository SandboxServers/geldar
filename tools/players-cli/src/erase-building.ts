// Building data of each erased life (BLD-fix4b): the seen-map sections in geldar-seen, the plan chunks in
// geldar-plans and the plan checkpoint in geldar-checkpoints. The key formats are copied from golem, not imported:
// this tool keeps no dependency on golem.
//   geldar-seen:        `<life_id>.<sx>.<sy>.<sz>`   (golem/src/building/seen/store.ts, sectionKey)
//   geldar-plans:       `<life_id>.<plan_id>.<seq>`  (golem/src/building/plan-store.ts, chunkKey)
//   geldar-checkpoints: `<life_id>.plan`             (golem/src/building/plan-checkpoint.ts, checkpointKey)
// The checkpoint bucket also holds the body checkpoint, keyed by the bare life id (golem/src/body/checkpoint.ts).
// Only the exact plan key is erased there; the body checkpoint is left for a separate decision (see the worknote).
// Life ids hold no dot (LIFE_ID in erase-owner.ts), so the prefix `<life_id>.` matches one life only.
// A bucket that does not exist (the building flag was never on) has nothing to erase and is not an error.
import type { KvPort } from './erase-owner.ts';

export const SEEN_BUCKET_NAME = 'geldar-seen';
export const PLAN_BUCKET_NAME = 'geldar-plans';
export const CHECKPOINT_BUCKET_NAME = 'geldar-checkpoints';

/** A bucket port that can also list its live keys (the caller filters them). */
export interface ListingKvPort extends KvPort {
  keys(): Promise<string[]>;
}

/** The building buckets. An absent field is a bucket that does not exist. */
export interface BuildingKvs {
  seen?: ListingKvPort | undefined;
  plans?: ListingKvPort | undefined;
  checkpoints?: KvPort | undefined;
}

/** Counts for one building bucket. `purged` rises as keys are purged, so a failed run still reports what was done. */
export interface BuildingCount {
  name: string;
  absent: boolean;
  candidates: number;
  found: number;
  purged: number;
}

/** A building bucket with the keys of the erased lives that are present, and its counts. */
export interface BuildingFound {
  port: KvPort | undefined;
  found: string[];
  count: BuildingCount;
}

/** Reads each key once; returns the keys that exist (a purge marker reads as absent). */
export async function presentKeys(port: KvPort, keys: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const key of keys) {
    if ((await port.get(key)) !== null) found.push(key);
  }
  return found;
}

/** The keys of the erased lives in a bucket keyed `<life_id>.<rest>`: every key with one of the life prefixes. */
export function lifeKeys(all: string[], lifeIds: string[]): string[] {
  return all.filter((key) => lifeIds.some((id) => key.startsWith(`${id}.`)));
}

/** The plan checkpoint key of each life. */
export function checkpointKeys(lifeIds: string[]): string[] {
  return lifeIds.map((id) => `${id}.plan`);
}

async function bucketFound(
  name: string,
  port: KvPort | undefined,
  candidates: string[],
): Promise<BuildingFound> {
  const found = port ? await presentKeys(port, candidates) : [];
  return {
    port,
    found,
    count: {
      name,
      absent: port === undefined,
      candidates: candidates.length,
      found: found.length,
      purged: 0,
    },
  };
}

/** Reads the candidate keys of each building bucket and keeps the ones present. Reads only; nothing is purged. */
export async function findBuilding(kvs: BuildingKvs, lifeIds: string[]): Promise<BuildingFound[]> {
  const seenAll = kvs.seen ? await kvs.seen.keys() : [];
  const plansAll = kvs.plans ? await kvs.plans.keys() : [];
  return [
    await bucketFound(SEEN_BUCKET_NAME, kvs.seen, lifeKeys(seenAll, lifeIds)),
    await bucketFound(PLAN_BUCKET_NAME, kvs.plans, lifeKeys(plansAll, lifeIds)),
    await bucketFound(CHECKPOINT_BUCKET_NAME, kvs.checkpoints, checkpointKeys(lifeIds)),
  ];
}

/** Purges the present keys of each building bucket. Stops at the first purge error; the counts keep what was done. */
export async function purgeBuilding(buckets: BuildingFound[]): Promise<void> {
  for (const bucket of buckets) {
    for (const key of bucket.found) {
      await bucket.port?.purge(key);
      bucket.count.purged += 1;
    }
  }
}

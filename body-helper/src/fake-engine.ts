// An in-memory Engine for the helper's tests. It holds containers with labels and answers the BodyEngine and
// SweepEngine calls the way the Docker adapter does. It is test code only: nothing in the helper imports it.

import { SOVEREIGN_HOST_KEY, SOVEREIGN_HOST_VALUE } from './engine.ts';
import type { BodyEngine, ContainerState } from './service.ts';
import type { SweepBody, SweepEngine } from './sweep.ts';
import { BODY_LABEL } from './template.ts';

export interface FakeContainer {
  name: string;
  id: string;
  running: boolean;
  labels: Record<string, string>;
}

export interface FakeEngine extends BodyEngine, SweepEngine {
  containers: FakeContainer[];
  created: string[];
}

/** A Body container as the helper creates it (running or not). */
export function bodyFixture(name: string, running: boolean, owner = 'owner-1'): FakeContainer {
  return { name, id: `id-${name}`, running, labels: { [BODY_LABEL]: name, 'geldar.owner': owner } };
}

/** A sovereign player host, as colo-admin.sh's `compose run` leaves it. */
export function hostFixture(id: string, running = true): FakeContainer {
  return {
    name: `geldar-colo-players-host-${id}`,
    id: `host-${id}`,
    running,
    labels: { [SOVEREIGN_HOST_KEY]: SOVEREIGN_HOST_VALUE },
  };
}

export function createFakeEngine(seed: FakeContainer[] = []): FakeEngine {
  const containers = [...seed];
  const created: string[] = [];
  const byName = (name: string) => containers.find((c) => c.name === name);
  const byId = (id: string) => containers.find((c) => c.id === id);
  let next = 0;
  return {
    containers,
    created,
    async inspect(name): Promise<ContainerState | null> {
      const found = byName(name);
      return found
        ? { id: found.id, running: found.running, helperBody: BODY_LABEL in found.labels }
        : null;
    },
    async countCounted() {
      return containers.filter(
        (c) => c.running && (BODY_LABEL in c.labels || SOVEREIGN_HOST_KEY in c.labels),
      ).length;
    },
    async create(name, config) {
      next++;
      const labels = (config.Labels ?? {}) as Record<string, string>;
      const id = `new-${next}`;
      containers.push({ name, id, running: false, labels });
      created.push(name);
      return id;
    },
    async start(id) {
      const found = byId(id);
      if (!found) throw new Error('docker start refused');
      found.running = true;
    },
    async stop(name) {
      const found = byName(name);
      if (found) found.running = false;
    },
    async remove(id) {
      const index = containers.findIndex((c) => c.id === id);
      if (index >= 0) containers.splice(index, 1);
    },
    async logs(name) {
      return `log of ${name}`;
    },
    async bodies(): Promise<SweepBody[]> {
      return containers
        .filter((c) => BODY_LABEL in c.labels)
        .map((c) => ({
          name: c.labels[BODY_LABEL] ?? '',
          owner: c.labels['geldar.owner'] ?? '',
          running: c.running,
        }));
    },
  };
}

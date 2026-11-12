import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

// Test doubles for the perception tests. No production code imports this file. A build or lint
// config that includes *.test.ts must exclude *.fakes.ts too, or the doubles ship.

/** One block of the fake world. A `solid` block stops a line of sight; water and air do not. */
export interface FakeBlock {
  name: string;
  position: Vec3;
  solid: boolean;
  shapes: unknown[];
  getSignText?: () => [string, string?];
}

/** An entity as Mineflayer lists it, with the fields perception reads. */
export interface FakeEntity {
  type: string;
  name?: string;
  username?: string;
  position: Vec3;
  height?: number;
  heldItem?: { name: string } | null;
  /** Mineflayer's metadata by index; a dropped item's stack is in slot 8. */
  metadata?: unknown[];
}

const NOT_SOLID = new Set(['water', 'lava', 'air']);

/**
 * A fake world with the parts perception reads: `findBlocks`, `blockAt`, `world.raycast`,
 * `entity`, `entities`. The raycast walks the ray in small steps and offers every cell it enters
 * to the matcher, like prismarine-world does, and an iterator whose `intersect` is non-null for
 * solid blocks only.
 */
export class FakeWorld {
  readonly blocks = new Map<string, FakeBlock>();
  readonly entities: Record<number, FakeEntity> = {};
  readonly me: { position: Vec3; eyeHeight: number } = {
    position: new Vec3(0.5, 64, 0.5),
    eyeHeight: 1.62,
  };
  /** Every `findBlocks` option set the bot was called with. */
  readonly findCalls: { count: number | undefined; maxDistance: number | undefined }[] = [];

  /** Puts a block at a position, replacing what was there. Sign text is given for signs. */
  set(name: string, x: number, y: number, z: number, signText?: [string, string?]): FakeBlock {
    const block: FakeBlock = {
      name,
      position: new Vec3(x, y, z),
      solid: !NOT_SOLID.has(name),
      shapes: NOT_SOLID.has(name) ? [] : [[0, 0, 0, 1, 1, 1]],
    };
    if (signText) block.getSignText = () => signText;
    this.blocks.set(`${x},${y},${z}`, block);
    return block;
  }

  /** Removes the block at a position. */
  clear(x: number, y: number, z: number): void {
    this.blocks.delete(`${x},${y},${z}`);
  }

  /** The block at a position, or null for air. */
  at(point: Vec3): FakeBlock | null {
    return (
      this.blocks.get(`${Math.floor(point.x)},${Math.floor(point.y)},${Math.floor(point.z)}`) ??
      null
    );
  }

  private blockOrAir(point: Vec3): FakeBlock {
    return (
      this.at(point) ?? {
        name: 'air',
        position: new Vec3(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)),
        solid: false,
        shapes: [],
      }
    );
  }

  /** The fake bot, typed as a Mineflayer bot for the code under test. */
  get bot(): Bot {
    return {
      username: 'Kestrel',
      entity: this.me,
      entities: this.entities,
      registry: { items: {} },
      // As in Mineflayer, a loaded chunk answers air with an air block, never null.
      blockAt: (point: Vec3) => this.blockOrAir(point),
      findBlocks: (options: {
        point?: Vec3;
        matching: (block: FakeBlock) => boolean;
        maxDistance?: number;
        count?: number;
      }) => {
        this.findCalls.push({ count: options.count, maxDistance: options.maxDistance });
        const from = options.point ?? this.me.position;
        return [...this.blocks.values()]
          .filter((block) => block.position.distanceTo(from) <= (options.maxDistance ?? 16))
          .filter((block) => options.matching(block))
          .sort((a, b) => a.position.distanceTo(from) - b.position.distanceTo(from))
          .slice(0, options.count ?? 1)
          .map((block) => block.position);
      },
      world: {
        raycast: (
          from: Vec3,
          direction: Vec3,
          range: number,
          matcher: (block: FakeBlock, iter: unknown) => boolean,
        ) => this.raycast(from, direction, range, matcher),
      },
    } as unknown as Bot;
  }

  private raycast(
    from: Vec3,
    direction: Vec3,
    range: number,
    matcher: (block: FakeBlock, iter: unknown) => boolean,
  ): { position: Vec3 } | null {
    const iter = { intersect: (shapes: unknown[]) => (shapes.length > 0 ? {} : null) };
    let last = '';
    for (let travelled = 0; travelled <= range; travelled += 0.02) {
      const point = from.plus(direction.scaled(travelled));
      // Air cells are offered too, as in prismarine-world: the matcher can accept a non-solid target.
      const block = this.blockOrAir(point);
      const key = `${block.position.x},${block.position.y},${block.position.z}`;
      if (key === last) continue;
      last = key;
      if (matcher(block, iter)) return { position: block.position };
    }
    return null;
  }
}

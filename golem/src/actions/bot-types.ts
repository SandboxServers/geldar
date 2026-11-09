import type { Bot } from 'mineflayer';

/** A block as Mineflayer's world model returns it (from `blockAt` or `findBlock`). */
export type Block = NonNullable<ReturnType<Bot['blockAt']>>;
/** An item stack in the bot's inventory. */
export type Item = ReturnType<Bot['inventory']['items']>[number];
/** One Mineflayer recipe. Tags expand into one recipe per variant. */
export type Recipe = ReturnType<Bot['recipesFor']>[number];
/** A window opened on a container block. */
export type Container = Awaited<ReturnType<Bot['openContainer']>>;
/** A plain block position: the shape the actions take as input and return in details. */
export type Position = { x: number; y: number; z: number };

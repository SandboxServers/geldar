/**
 * Mobs the game always classes as hostile (decision 0154, ruling 1): the Monster family of the
 * game's own classification, by Mineflayer's entity name. They are flagged `hostile` in the
 * snapshot whatever their state.
 *
 * Neutral and conditional mobs are NOT listed: wolf, enderman, piglin, zombified_piglin, bee,
 * iron_golem, spider and cave_spider. Their threat is read from observed state (`closing`,
 * `state`) and the held item, never from the type. Spider is conditional: neutral in daylight or
 * bright light unless provoked, hostile at night or in low light.
 *
 * Written from the game's classification as of the pinned Paper line (1.20.x); a name the game adds
 * later is not flagged until this list is updated.
 */
export const ALWAYS_HOSTILE: ReadonlySet<string> = new Set([
  'blaze',
  'creeper',
  'drowned',
  'elder_guardian',
  'endermite',
  'evoker',
  'ghast',
  'guardian',
  'hoglin',
  'husk',
  'magma_cube',
  'phantom',
  'pillager',
  'ravager',
  'shulker',
  'silverfish',
  'skeleton',
  'slime',
  'stray',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager',
]);

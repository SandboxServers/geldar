/**
 * Which food the Body eats (decision 0216). Pure: the caller passes the carried item names, the
 * registry's food numbers and the hunger, and gets the choice back. The action (`eat.ts`) and the eat
 * reflex's gate (`edibleAtHunger`) both read these rules.
 */

/** The food numbers the choice reads, from `bot.registry.foodsByName`. */
export interface FoodInfo {
  foodPoints: number;
  saturation: number;
}

/** The result of a choice: a food to eat, a refusal with the plain reason, or nothing edible. */
export type FoodChoice =
  | { kind: 'eat'; name: string }
  | { kind: 'refuse'; message: string }
  | { kind: 'none' };

/**
 * Foods the Body never picks, whatever the hunger: raw or harmful ones, and ones whose effects it
 * does not handle. `rotten_flesh` is listed too, but the last-resort rule below picks it.
 */
export const BANNED_FOODS = [
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'suspicious_stew',
  'chorus_fruit',
];
/** Any item whose name ends in this (milk, water, lava, fish buckets and so on) is never food. */
export const BANNED_SUFFIX = '_bucket';
/** Banned foods the Body eats only when nothing else is edible, and at or below LAST_RESORT_HUNGER (0168). */
export const LAST_RESORT_FOODS = ['rotten_flesh'];
/** Raw chicken: eaten only when nothing else is edible, and at or below LAST_RESORT_HUNGER. */
export const CHICKEN_FOODS = ['chicken'];
/** Golden items: eaten at any hunger, but only when nothing ordinary, chicken or rotten flesh is carried. */
export const GOLDEN_FOODS = ['golden_apple', 'enchanted_golden_apple', 'golden_carrot'];
/** The hunger (of 20) at or below which a last-resort food is eaten. */
export const LAST_RESORT_HUNGER = 6;
/** The refusal when the only food carried is rotten flesh and hunger is above the threshold. */
export const LAST_RESORT_REFUSAL =
  'only rotten flesh is carried; it is eaten only when hunger is 6 or below';
/** The refusal when the only food carried is raw chicken and hunger is above the threshold. */
export const CHICKEN_REFUSAL =
  'only raw chicken is carried; it is eaten only when hunger is 6 or below';
/** A full bar of food: the missing hunger is 20 minus the hunger. */
const FULL_FOOD = 20;

/** True for a name the Body never eats: a banned food, or any bucket. Rotten flesh counts as banned. */
function isBannedName(name: string): boolean {
  return BANNED_FOODS.includes(name) || name.endsWith(BANNED_SUFFIX);
}

/**
 * The tiers the Body may eat from at this hunger, in order: ordinary foods; raw chicken at or below
 * the threshold; golden items; rotten flesh at or below the threshold. Rotten flesh comes last, so it
 * is eaten only when nothing else is held (0168). A tier is an empty list when it is not allowed.
 */
function tiersAt(names: readonly string[], hunger: number): string[][] {
  const low = hunger <= LAST_RESORT_HUNGER;
  const ordinary = names.filter(
    (name) => !isBannedName(name) && !CHICKEN_FOODS.includes(name) && !GOLDEN_FOODS.includes(name),
  );
  const chicken = low ? names.filter((name) => CHICKEN_FOODS.includes(name)) : [];
  const golden = names.filter((name) => GOLDEN_FOODS.includes(name));
  const rotten = low ? names.filter((name) => LAST_RESORT_FOODS.includes(name)) : [];
  return [ordinary, chicken, golden, rotten];
}

/**
 * The names of the first tier the Body may eat from at this hunger, with no food numbers. The eat
 * reflex uses it as a gate: an empty list means the reflex does not start.
 */
export function edibleAtHunger(names: readonly string[], hunger: number): string[] {
  return tiersAt(names, hunger).find((tier) => tier.length > 0) ?? [];
}

/**
 * The food for the missing hunger among one tier. When some candidate fits the missing points, the
 * largest that fits; otherwise the smallest overshoot. Ties: lower saturation, then the name.
 * Names with no food entry are skipped. Null when nothing is left.
 */
function pickFit(
  names: readonly string[],
  foodsByName: Readonly<Record<string, FoodInfo | undefined>>,
  missing: number,
): string | null {
  const candidates = names.flatMap((name) =>
    Object.hasOwn(foodsByName, name) && foodsByName[name] !== undefined
      ? [{ name, food: foodsByName[name] as FoodInfo }]
      : [],
  );
  if (candidates.length === 0) return null;
  const fits = candidates.filter((c) => c.food.foodPoints <= missing);
  const pool = fits.length > 0 ? fits : candidates;
  const pointsFirst = (a: FoodInfo, b: FoodInfo): number =>
    fits.length > 0 ? b.foodPoints - a.foodPoints : a.foodPoints - b.foodPoints;
  pool.sort(
    (a, b) =>
      pointsFirst(a.food, b.food) ||
      a.food.saturation - b.food.saturation ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return pool[0]?.name ?? null;
}

/**
 * The food the Body eats from the names it carries at this hunger. The first tier with a candidate
 * wins, and within it the fit rule picks. When nothing is edible, a last-resort food that the hunger
 * rules out is refused with its plain reason; otherwise there is no food.
 */
export function chooseFood(
  names: readonly string[],
  foodsByName: Readonly<Record<string, FoodInfo | undefined>>,
  hunger: number,
): FoodChoice {
  const missing = FULL_FOOD - hunger;
  for (const tier of tiersAt(names, hunger)) {
    const name = pickFit(tier, foodsByName, missing);
    if (name !== null) return { kind: 'eat', name };
  }
  return hunger > LAST_RESORT_HUNGER ? refusalFor(names) : { kind: 'none' };
}

/**
 * The refusal for a carry with no edible food above the threshold. It names only what is carried:
 * raw chicken and rotten flesh (the last resorts), and inedible food (banned foods other than rotten
 * flesh; buckets are not food). With no last resort carried there is no refusal.
 */
function refusalFor(names: readonly string[]): FoodChoice {
  const chicken = names.some((name) => CHICKEN_FOODS.includes(name));
  const rotten = names.some((name) => LAST_RESORT_FOODS.includes(name));
  const inedible = names.some(
    (name) => BANNED_FOODS.includes(name) && !LAST_RESORT_FOODS.includes(name),
  );
  if (!chicken && !rotten) return { kind: 'none' };
  const edible = [chicken ? 'raw chicken' : null, rotten ? 'rotten flesh' : null].filter(
    (part): part is string => part !== null,
  );
  const carried = inedible ? [...edible, 'inedible food'] : edible;
  const subject =
    carried.length <= 2 ? carried.join(' and ') : `${carried[0]}, ${carried[1]} and ${carried[2]}`;
  const verb = carried.length === 1 ? 'is' : 'are';
  const eaten =
    edible.length === 2 ? 'they are eaten' : `${carried.length === 1 ? 'it' : edible[0]} is eaten`;
  return {
    kind: 'refuse',
    message: `only ${subject} ${verb} carried; ${eaten} only when hunger is ${LAST_RESORT_HUNGER} or below`,
  };
}

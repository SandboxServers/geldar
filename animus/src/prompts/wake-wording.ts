/**
 * The plain in-world wording of a wake reason, as the model reads it (decision 0068). The contract
 * and the thoughts table keep the reason codes (`mind_start`, `idle`, ...); only the text an agent
 * reads is worded here, so no code name reaches the prompt.
 */

const PLAIN: Readonly<Record<string, string>> = {
  directly_addressed: 'someone spoke to you directly',
  precondition_failed: 'a condition your plan was waiting for did not hold',
  unexpected_damage: 'you were hurt suddenly',
  goal_completed: 'you finished what you were doing',
  reflex_danger: 'you were in danger and reacted without thinking',
  action_failed: 'something you tried did not work',
  limit_reached: 'your plan ran for its full length',
  no_plan: 'you had nothing you were pursuing',
  speech_addressed: 'someone spoke to you by name',
  speech_about_me: 'someone talked about you',
  speech_about_my_commitments: 'someone talked about a promise you made',
  idle: 'it had been quiet for a while and you had no plan running',
  fallback: 'it was time to look at things again',
  mind_start: 'you had just come into this life',
};

/** The wording of a wake reason; an unknown reason reads as a plain change in the world. */
export function wakeWording(reason: string): string {
  const near = /^new_agent_within_(\d+)$/.exec(reason);
  if (near) return `someone new came within ${near[1]} blocks of you`;
  return PLAIN[reason] ?? 'something changed around you';
}

import type { LookResult, Snapshot, UntrustedWorldText } from '@geldar/contract';

/** Heard lines kept in the play view, newest first (the design table). */
export const PLAY_SPEECH_LIMIT = 40;

/** Sign texts kept in the play view (the `signs` maxItems of the contract). */
export const PLAY_SIGN_LIMIT = 20;

/** Entity records kept in the play view, nearest first (the Body's snapshot keeps more). */
export const PLAY_ENTITY_LIMIT = 12;

export type PlaySnapshot = LookResult['snapshot'];
export type Signs = NonNullable<UntrustedWorldText['signs']>;

/** Values the Threshold fills in from Postgres; the snapshot from the Body does not know them. */
export interface PlayViewOptions {
  /** Thoughts left today, from `mcp_budget`. */
  budget: number;
  /** Days since the last sleep, from the Postgres record of the life. */
  daysSinceSleep: number;
}

export interface PlayView {
  snapshot: PlaySnapshot;
  untrusted: UntrustedWorldText;
}

/** One section of the play view's snapshot part, projected from the Body's snapshot. */
export type SnapshotProjector = (
  snapshot: Snapshot,
  options: PlayViewOptions,
) => Partial<PlaySnapshot>;

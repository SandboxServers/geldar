/**
 * The one-in-flight slot of the owner's body requests (C7-04c fix J). It holds the owners with a request in flight.
 * C7-04c2 creates one slot and passes the same object to every body router through BodyDeps.slot; the retire route
 * (C7-04d) takes it from there too, so a retire and a stop cannot both reach the supervisor. Never copy it.
 */
export type BodySlot = Set<string>;

export function createBodySlot(): BodySlot {
  return new Set<string>();
}

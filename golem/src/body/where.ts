/** Where the Body is, for a log line: the feet position to one decimal and the dimension. */
export interface Place {
  x: number | null;
  y: number | null;
  z: number | null;
  dimension: string | null;
}

/**
 * The position fields of a log line. A position or dimension that is not known is null, never left
 * out, so a line written before the Body has spawned still has the same shape.
 */
export function placeFields(
  position: { x: number; y: number; z: number } | null | undefined,
  dimension: string | null | undefined,
): Place {
  const tenth = (value: number): number => Math.round(value * 10) / 10;
  return {
    x: position ? tenth(position.x) : null,
    y: position ? tenth(position.y) : null,
    z: position ? tenth(position.z) : null,
    dimension: dimension ?? null,
  };
}

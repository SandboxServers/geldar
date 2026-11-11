/**
 * Integration floor: the repo keeps at least `floor` integration test files,
 * so a suite that quietly stops being collected (a renamed file, a glob that
 * no longer matches) fails the gate instead of passing with fewer tests. An
 * integration test file is one named `*.it.test.ts` or `*.live.test.ts` that
 * contains at least one `it(` call. The floor is read from
 * `integration-floor.json`. Every failure to read or count fails the gate:
 * nothing here falls back to a pass.
 */

/** The file names of integration and live tests, as the repo names them. */
export const INTEGRATION_FILE = /\.(?:it|live)\.test\.ts$/;

/** The number of integration test files: a matching name with at least one `it(`. */
export function countIntegrationFiles(files: { path: string; text: string }[]): number {
  return files.filter((file) => INTEGRATION_FILE.test(file.path) && /\bit\(/.test(file.text))
    .length;
}

/** The floor from `integration-floor.json`, which holds `{ "floor": <non-negative integer> }`. */
export function parseIntegrationFloor(text: string | undefined, path: string): number | string {
  if (text === undefined) return `${path} cannot be read`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return `${path} is not valid JSON`;
  }
  const floor = (parsed as { floor?: unknown } | null)?.floor;
  if (typeof floor !== 'number' || !Number.isInteger(floor) || floor < 0) {
    return `${path} must hold { "floor": <non-negative integer> }`;
  }
  return floor;
}

/**
 * One problem when the count cannot be computed (`undefined`), when the floor
 * cannot be read, or when the count is below the floor.
 */
export function checkIntegrationFloor(
  count: number | undefined,
  floorText: string | undefined,
  floorPath: string,
): string[] {
  const floor = parseIntegrationFloor(floorText, floorPath);
  if (typeof floor === 'string') return [floor];
  if (count === undefined) {
    return ['the integration test count cannot be computed; the floor cannot be checked'];
  }
  if (count < floor) {
    return [
      `${count} integration test files (*.it.test.ts, *.live.test.ts with an it() call); the floor in ${floorPath} is ${floor}`,
    ];
  }
  return [];
}

import { describe, expect, it } from 'vitest';
import {
  checkIntegrationFloor,
  countIntegrationFiles,
  INTEGRATION_FILE,
  parseIntegrationFloor,
} from './integration-floor.ts';

const FLOOR_PATH = 'tools/repo-checks/src/integration-floor.json';

describe('countIntegrationFiles', () => {
  it('counts *.it.test.ts and *.live.test.ts files that contain an it() call', () => {
    const files = [
      { path: 'eventsink/test/a.it.test.ts', text: "it('works', () => {});" },
      {
        path: 'golem/test/live/b.live.test.ts',
        text: "describe('b', () => { it('runs', () => {}); });",
      },
      { path: 'golem/test/live/c.live.test.ts', text: 'export const helper = 1;' },
      { path: 'golem/test/live/d.ts', text: "it('not a test file name', () => {});" },
      { path: 'eventsink/src/e.test.ts', text: "it('unit, not integration', () => {});" },
    ];
    expect(countIntegrationFiles(files)).toBe(2);
  });

  it('names integration and live files and nothing else', () => {
    expect(INTEGRATION_FILE.test('a/b.it.test.ts')).toBe(true);
    expect(INTEGRATION_FILE.test('a/b.live.test.ts')).toBe(true);
    expect(INTEGRATION_FILE.test('a/b.test.ts')).toBe(false);
  });
});

describe('parseIntegrationFloor', () => {
  it('reads a non-negative integer floor', () => {
    expect(parseIntegrationFloor('{"floor": 44}', FLOOR_PATH)).toBe(44);
    expect(parseIntegrationFloor('{"floor": 0}', FLOOR_PATH)).toBe(0);
  });

  it('rejects an unreadable file, invalid JSON, and a bad floor value', () => {
    expect(parseIntegrationFloor(undefined, FLOOR_PATH)).toMatch(/cannot be read/);
    expect(parseIntegrationFloor('{', FLOOR_PATH)).toMatch(/not valid JSON/);
    expect(parseIntegrationFloor('{"floor": "44"}', FLOOR_PATH)).toMatch(/must hold/);
    expect(parseIntegrationFloor('{"floor": -1}', FLOOR_PATH)).toMatch(/must hold/);
    expect(parseIntegrationFloor('null', FLOOR_PATH)).toMatch(/must hold/);
  });
});

describe('checkIntegrationFloor', () => {
  it('passes when the count meets the floor', () => {
    expect(checkIntegrationFloor(44, '{"floor": 44}', FLOOR_PATH)).toEqual([]);
    expect(checkIntegrationFloor(45, '{"floor": 44}', FLOOR_PATH)).toEqual([]);
  });

  it('fails when the count is below the floor', () => {
    const problems = checkIntegrationFloor(43, '{"floor": 44}', FLOOR_PATH);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('43 integration test files');
  });

  it('fails, not passes, when the count cannot be computed', () => {
    const problems = checkIntegrationFloor(undefined, '{"floor": 44}', FLOOR_PATH);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('cannot be computed');
  });

  it('fails, not passes, when the floor file is unreadable', () => {
    const problems = checkIntegrationFloor(44, undefined, FLOOR_PATH);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('cannot be read');
  });
});

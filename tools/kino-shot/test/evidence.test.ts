import { describe, expect, it } from 'vitest';
import { parseArgs, validateUrl } from '../src/args.ts';
import {
  agentIndex,
  buildSummary,
  canvasLooksRendered,
  checksFrom,
  parseStatus,
  pixelFractions,
  redact,
  tally,
} from '../src/evidence.ts';

const rgba = (px: [number, number, number][]): Uint8Array =>
  Uint8Array.from(px.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('parseArgs', () => {
  it('defaults and env', () => {
    const a = parseArgs([], { KINO_URL: 'https://example.test/kino/' });
    expect(a).toMatchObject({
      mode: 'follow',
      seconds: 25,
      agent: null,
      out: '.claude/kino-shots',
    });
    expect(a.viewport).toEqual({ width: 430, height: 900 });
  });
  it('reads options, ignoring a bare --', () => {
    const a = parseArgs(
      [
        '--',
        '--url',
        'https://e.test/k/',
        '--agent',
        'ag_jason_01',
        '--mode',
        'orbit',
        '--seconds',
        '5',
        '--viewport',
        '800x600',
      ],
      {},
    );
    expect(a).toMatchObject({ agent: 'ag_jason_01', mode: 'orbit', seconds: 5 });
    expect(a.viewport).toEqual({ width: 800, height: 600 });
  });
  it('rejects bad input', () => {
    const e = { KINO_URL: 'https://e.test/' };
    expect(() => parseArgs(['--mode', 'fly'], e)).toThrow(/mode/);
    expect(() => parseArgs(['--seconds', '0'], e)).toThrow(/seconds/);
    expect(() => parseArgs(['--seconds', '999'], e)).toThrow(/seconds/);
    expect(() => parseArgs(['--viewport', 'wide'], e)).toThrow(/viewport/);
    expect(() => parseArgs(['--agent', 'a b'], e)).toThrow(/agent/);
    expect(() => parseArgs(['--bogus', '1'], e)).toThrow(/unknown/);
    expect(() => parseArgs(['--url'], {})).toThrow(/value/);
    expect(() => parseArgs([], {})).toThrow(/KINO_URL/);
  });
});

describe('validateUrl', () => {
  it('accepts https and http on localhost only', () => {
    expect(validateUrl('https://e.test/kino/')).toBe('https://e.test/kino/');
    expect(validateUrl('http://localhost:8080/kino/')).toContain('localhost');
    expect(validateUrl('http://127.0.0.1:8080/')).toContain('127.0.0.1');
    expect(() => validateUrl('http://e.test/kino/')).toThrow(/https/);
    expect(() => validateUrl('ftp://localhost/')).toThrow(/https/);
    expect(() => validateUrl('https://u:p@e.test/')).toThrow(/credentials/);
    expect(() => validateUrl('nonsense')).toThrow(/valid/);
  });
});

describe('pixelFractions', () => {
  it('counts near-magenta and near-black', () => {
    const f = pixelFractions(
      rgba([
        [255, 0, 255],
        [250, 10, 240],
        [0, 0, 0],
        [90, 140, 60],
      ]),
    );
    expect(f.magenta).toBe(0.5);
    expect(f.black).toBe(0.25);
    expect(f.pixels).toBe(4);
  });
  it('judges rendered canvases', () => {
    expect(canvasLooksRendered(pixelFractions(rgba(Array(10).fill([255, 0, 255]))))).toBe(false);
    expect(canvasLooksRendered(pixelFractions(rgba(Array(10).fill([0, 0, 0]))))).toBe(false);
    expect(canvasLooksRendered(pixelFractions(rgba(Array(10).fill([90, 140, 60]))))).toBe(true);
    expect(canvasLooksRendered({ magenta: 0, black: 0, pixels: 0 })).toBe(false);
  });
});

describe('redact', () => {
  it('removes bearer tokens, key=value secrets, JWTs and long hex', () => {
    expect(redact('Authorization: Bearer abcdef123456789')).not.toContain('abcdef123456789');
    expect(redact('token=supersecretvalue&x=1')).toBe('token=[redacted]&x=1');
    expect(redact('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIx.sig')).toBe('jwt [redacted]');
    expect(redact(`k ${'a1'.repeat(20)}`)).toBe('k [redacted]');
    expect(redact('chunks 12 connected')).toBe('chunks 12 connected');
  });
});

describe('status and summary', () => {
  it('parses the status line', () => {
    expect(parseStatus('connected | chunks 12 | entities 3 | atlas ready (9)')).toEqual({
      connected: true,
      chunks: 12,
      entities: 3,
    });
    expect(parseStatus('not connected | chunks 0 | entities 0 | atlas loading')?.connected).toBe(
      false,
    );
    expect(parseStatus('hello')).toBeNull();
  });
  it('builds pass and fail summaries', () => {
    const good = pixelFractions(rgba(Array(4).fill([90, 140, 60])));
    const ok = buildSummary(
      checksFrom(2, ['connected | chunks 5 | entities 1 | atlas ready (3)'], good),
      good,
      {},
      0,
    );
    expect(ok.ok).toBe(true);
    const noChunks = checksFrom(2, ['connected | chunks 0 | entities 1 | atlas ready (3)'], good);
    expect(buildSummary(noChunks, good, {}, 0).ok).toBe(false);
    expect(buildSummary(checksFrom(0, [], null), null, {}, 2).ok).toBe(false);
  });
  it('tallies', () => {
    expect(tally(['200', '200', '429'])).toEqual({ '200': 2, '429': 1 });
  });
});

describe.skipIf(!process.env.KINO_URL)('live', () => {
  it('has a valid KINO_URL', () => {
    expect(() => validateUrl(process.env.KINO_URL)).not.toThrow();
  });
});

describe('agentIndex', () => {
  const agents = [
    { id: 'ag_mossy_01', label: 'Mossy' },
    { id: 'ag_moss_02', label: 'Moss' },
    { id: 'ag_twin_03', label: 'Moss' },
  ];
  it('picks an exact id before any label, and never a substring', () => {
    expect(agentIndex(agents, 'ag_moss_02')).toBe(1);
    expect(agentIndex(agents, 'ag_twin_03')).toBe(2);
    expect(agentIndex(agents, 'Moss')).toBe(1);
    expect(agentIndex(agents, 'Mos')).toBe(-1);
    expect(agentIndex(agents, 'ag_nobody')).toBe(-1);
  });
});

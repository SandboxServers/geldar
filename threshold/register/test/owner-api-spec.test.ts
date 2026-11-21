import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

// The OpenAPI source is parsed, not sliced: a lost newline makes the file invalid YAML and drops paths.
const text = readFileSync(new URL('../src/api/owner-api-v1.yaml', import.meta.url), 'utf8');
const parsed = parseDocument(text);
// biome-ignore lint/suspicious/noExplicitAny: the OpenAPI document is untyped JSON here.
const spec = parsed.toJS() as any;

describe('owner API OpenAPI document parses (C7-13a)', () => {
  it('has no YAML parse errors', () => {
    expect(parsed.errors.map((e) => e.message)).toEqual([]);
  });

  it('keeps the agent routes and adds the skin routes as their own paths', () => {
    expect(Object.keys(spec.paths)).toContain('/agents/{playerId}');
    expect(spec.paths['/agents/{playerId}'].get).toBeDefined();
    expect(spec.paths['/agents/{playerId}'].patch).toBeDefined();
    expect(spec.paths['/agents/{playerId}/skin']).toBeDefined();
  });

  it('describes the skin POST: image/png body and every answer the route gives', () => {
    const post = spec.paths['/agents/{playerId}/skin'].post;
    expect(Object.keys(post.requestBody.content)).toEqual(['image/png']);
    expect(Object.keys(post.responses).sort()).toEqual(
      ['202', '401', '403', '404', '409', '422', '429', '500'].sort(),
    );
  });

  it('describes the skin GET as its own operation', () => {
    expect(spec.paths['/agents/{playerId}/skin'].get).toBeDefined();
  });
});

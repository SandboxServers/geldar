import { describe, expect, it } from 'vitest';
import { ROUTES, resolveRoute } from './routes.ts';

const PATHS = ['/api/agents', '/api/thoughts', '/api/thoughts/abc', '/api/receipts', '/api/stream'];
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'TRACE'];

describe('the route table', () => {
  it('lists exactly the five routes, all GET, and no stats route', () => {
    expect(ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /api/agents',
      'GET /api/thoughts',
      'GET /api/thoughts/:id',
      'GET /api/receipts',
      'GET /api/stream',
    ]);
  });

  it.each(PATHS)('answers GET %s and refuses every other method with 405', (path) => {
    expect(resolveRoute('GET', path).status).toBe('found');
    for (const method of WRITE_METHODS) {
      expect(resolveRoute(method, path)).toEqual({
        status: 'method-not-allowed',
        allow: ['GET'],
      });
    }
  });

  it('answers 404 for an unknown path, a trailing slash and an empty id', () => {
    expect(resolveRoute('GET', '/api/nope').status).toBe('not-found');
    expect(resolveRoute('GET', '/api/stats').status).toBe('not-found');
    expect(resolveRoute('GET', '/api/agents/').status).toBe('not-found');
    expect(resolveRoute('GET', '/api/thoughts/').status).toBe('not-found');
    expect(resolveRoute('POST', '/').status).toBe('not-found');
  });

  it('reads the id and the query string, and refuses an undecodable id', () => {
    const hit = resolveRoute('GET', '/api/thoughts/t%201?agent=kestrel');
    expect(hit).toMatchObject({ status: 'found', name: 'thought', params: { id: 't 1' } });
    if (hit.status === 'found') expect(hit.query.get('agent')).toBe('kestrel');
    expect(resolveRoute('GET', '/api/thoughts/%E0%A4%A').status).toBe('not-found');
  });
});

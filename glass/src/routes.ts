/**
 * The route table: the only routes Glass serves. Every route is GET. Any other method on a known
 * path gets 405, and an unknown path gets 404. routes.test.ts enumerates this table.
 */

export type RouteName = 'agents' | 'thoughts' | 'thought' | 'receipts' | 'stream';

export interface RouteEntry {
  method: 'GET';
  path: string;
  name: RouteName;
}

export const ROUTES: readonly RouteEntry[] = [
  { method: 'GET', path: '/api/agents', name: 'agents' },
  { method: 'GET', path: '/api/thoughts', name: 'thoughts' },
  { method: 'GET', path: '/api/thoughts/:id', name: 'thought' },
  { method: 'GET', path: '/api/receipts', name: 'receipts' },
  { method: 'GET', path: '/api/stream', name: 'stream' },
];

export type Resolution =
  | { status: 'found'; name: RouteName; params: Record<string, string>; query: URLSearchParams }
  | { status: 'not-found' }
  | { status: 'method-not-allowed'; allow: string[] };

/** Matches a path against a pattern whose `:name` segments take one non-empty segment each. */
function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i += 1) {
    const w = want[i] ?? '';
    const g = got[i] ?? '';
    if (w.startsWith(':')) {
      if (g === '') return null;
      try {
        params[w.slice(1)] = decodeURIComponent(g);
      } catch {
        return null;
      }
    } else if (w !== g) {
      return null;
    }
  }
  return params;
}

/** Resolves a request line to a route, or to 404 or 405. The base URL is never used for a host. */
export function resolveRoute(method: string | undefined, url: string | undefined): Resolution {
  let pathname: string;
  let query: URLSearchParams;
  try {
    const parsed = new URL(url ?? '/', 'http://glass.invalid');
    pathname = parsed.pathname;
    query = parsed.searchParams;
  } catch {
    return { status: 'not-found' };
  }
  const matched: { route: RouteEntry; params: Record<string, string> }[] = [];
  for (const route of ROUTES) {
    const params = matchPath(route.path, pathname);
    if (params !== null) matched.push({ route, params });
  }
  if (matched.length === 0) return { status: 'not-found' };
  const hit = matched.find((m) => m.route.method === method);
  if (hit === undefined) {
    return {
      status: 'method-not-allowed',
      allow: [...new Set(matched.map((m) => m.route.method))],
    };
  }
  return { status: 'found', name: hit.route.name, params: hit.params, query };
}

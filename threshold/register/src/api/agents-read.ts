import { SECURITY_HEADERS } from '../pages.ts';
import { sendProblem } from '../problem.ts';
import { ownedAgent } from './guard.ts';
import type { ApiRoute } from './route.ts';

/** GET /agents/{playerId}: the one resource route of C7-04a (scope read). */
export const agentsReadRoutes: readonly ApiRoute[] = [
  {
    method: 'GET',
    pattern: /^\/agents\/([^/]+)$/,
    scope: 'read',
    write: false,
    async handler(ctx) {
      const agent = await ownedAgent(ctx.deps, ctx.ownerId, ctx.params[0] ?? '');
      if (agent === null) return sendProblem(ctx.res, 'not_found');
      ctx.res.writeHead(200, { 'content-type': 'application/json', ...SECURITY_HEADERS });
      ctx.res.end(JSON.stringify(agent));
    },
  },
];

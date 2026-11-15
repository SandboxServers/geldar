import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The time-of-day dial (BM-15, geldar-sky.js) is served the way geldar-chat.js is: a read-only mount in colo.yml, a Caddy
// handler, the config bundle's allowlist, and the settings.json scripts entry that the README and runbook document.
const read = (rel: string) =>
  readFileSync(join(import.meta.dirname, '..', '..', '..', rel), 'utf8');

describe('sky dial: wiring', () => {
  it('compose mounts the script read only into the bluemap-web Caddy root', () => {
    expect(read('compose/colo.yml')).toContain(
      '../plugins/bluemap/web/geldar-sky.js:/etc/caddy/geldar-sky.js:ro',
    );
  });

  it('Caddy serves the script at /assets/geldar-sky.js as JavaScript, behind the GET and HEAD rule', () => {
    const caddy = read('compose/bluemap-web/Caddyfile');
    const block = /handle \/assets\/geldar-sky\.js \{([\s\S]*?)\n\t\}/.exec(caddy)?.[1] ?? '';
    expect(caddy).toContain('@not_allowed not method GET HEAD');
    expect(block).toContain('root * /etc/caddy');
    expect(block).toContain('rewrite * /geldar-sky.js');
    expect(block).toContain('header Content-Type "text/javascript; charset=utf-8"');
    expect(block).toContain('file_server');
  });

  it('the config bundle ships the script, so the node has the file the mount reads', () => {
    expect(read('deploy/genesis/config-bundle.list')).toContain(
      '\nplugins/bluemap/web/geldar-sky.js\n',
    );
  });

  it('the runbook loads both scripts through settings.json scripts', () => {
    expect(read('docs/runbooks/map-chat-panel.md')).toContain(
      '"scripts": ["assets/geldar-chat.js", "assets/geldar-sky.js"]',
    );
  });
});

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflow = readFileSync(resolve(root, '.github', 'workflows', 'mcp-mock-image.yml'), 'utf8');

// The workflow cannot run in a unit test, so these pin the lines that gate publishing.
describe('mcp-mock-image workflow', () => {
  it('logs in and pushes only on main, never from a pull request or another ref', () => {
    const gate = "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'";
    expect(workflow).toContain(`if: ${gate}`);
    expect(workflow).toContain(`push: \${{ ${gate} }}`);
  });
});
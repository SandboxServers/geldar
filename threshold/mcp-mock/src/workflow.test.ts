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
    const login = workflow.slice(workflow.indexOf('docker/login-action'));
    expect(login.slice(0, login.indexOf('with:'))).toContain(`if: ${gate}`);
    const push = workflow.slice(workflow.indexOf('id: push'));
    expect(push.slice(0, push.indexOf('with:'))).toContain(`if: ${gate}`);
  });

  it('does not persist the checkout credentials', () => {
    expect(workflow).toContain('persist-credentials: false');
  });

  it('tests the loaded image before it logs in or pushes', () => {
    const test = workflow.indexOf('name: image test');
    const login = workflow.indexOf('docker/login-action');
    const push = workflow.indexOf('push: true');
    expect(test).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(test);
    expect(push).toBeGreaterThan(login);
    // The build that precedes the test loads the image and never pushes.
    const beforeTest = workflow.slice(workflow.indexOf('name: build'), test);
    expect(beforeTest).toContain('load: true');
    expect(beforeTest).not.toMatch(/push:/);
  });

  it('serialises runs per ref without cancelling a publish', () => {
    expect(workflow).toContain('group: mcp-mock-image-${{ github.ref }}');
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('rebuilds when the workspace manifests change', () => {
    // Each block ends at the next trigger key, so a neighbour's paths cannot satisfy it.
    const next = { pull_request: '\n  push:', push: '\n  workflow_dispatch:' };
    for (const [trigger, end] of Object.entries(next)) {
      const start = workflow.indexOf(`\n  ${trigger}:`);
      expect(start, trigger).toBeGreaterThan(-1);
      const stop = workflow.indexOf(end, start);
      expect(stop, `${trigger} end`).toBeGreaterThan(start);
      const block = workflow.slice(start, stop);
      expect(block, trigger).toContain('\n      - package.json\n');
      expect(block, trigger).toContain('\n      - pnpm-workspace.yaml\n');
    }
  });

  it('writes the digest only when something was pushed', () => {
    const summary = workflow.slice(workflow.indexOf('name: write the digest'));
    expect(summary).toContain("if: github.event_name != 'pull_request'");
  });

  it('has no unused env', () => {
    expect(workflow).not.toMatch(/^\s+IMAGE:/m);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkEnvDefinitions, ENV_SCHEMA } from './env-definitions.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const schemaText = readFileSync(join(root, ENV_SCHEMA), 'utf8');
const exampleText = readFileSync(join(root, 'envs', 'test.example.yaml'), 'utf8');

describe('checkEnvDefinitions', () => {
  it('passes the committed example environment against the committed schema', () => {
    const files = [{ path: 'envs/test.example.yaml', text: exampleText }];
    expect(checkEnvDefinitions(files, schemaText)).toEqual([]);
  });

  it('fails an environment whose kill switch is false', () => {
    const files = [
      {
        path: 'envs/colo.yaml',
        text: exampleText.replace('register_kill_switch: true', 'register_kill_switch: false'),
      },
    ];
    const problems = checkEnvDefinitions(files, schemaText);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('/register_kill_switch fails const');
  });

  it('fails when an environment file exists and the schema is missing', () => {
    const files = [{ path: 'envs/test.example.yaml', text: exampleText }];
    expect(checkEnvDefinitions(files, undefined)).toEqual([
      `${ENV_SCHEMA} is missing; envs/*.yaml cannot be validated`,
    ]);
  });

  it('ignores files outside envs/ and the schema itself', () => {
    const files = [
      { path: 'docs/notes.yaml', text: 'kill: false\n' },
      { path: 'envs/environment.schema.json', text: schemaText },
    ];
    expect(checkEnvDefinitions(files, undefined)).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schemaPath = new URL('../schemas/mcp-survey.schema.json', import.meta.url);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  $defs: { SurveyResult: { description: string } };
};

describe('survey result description', () => {
  const description = schema.$defs.SurveyResult.description;

  it('explains the @<minutes> stale mark', () => {
    expect(description).toContain('@<minutes>');
    expect(description).toContain('game minutes ago');
  });

  it('explains the trailing i inherited mark', () => {
    expect(description).toContain(
      'a trailing i means that sighting was inherited from a previous life',
    );
    expect(description).toContain('the cells are not re-checked');
  });
});

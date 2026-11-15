/**
 * Validates one `envs/<name>.yaml`: it must parse as one YAML document with no duplicate
 * keys, pass the leak scan (leak-scan.ts), and match the schema. Messages name the file,
 * the location and the rule; they never repeat a value.
 */
import ajvModule from 'ajv';
import { parseDocument } from 'yaml';
import { findLeaks } from './leak-scan.ts';

// ajv is CommonJS: the class is `.default`, as contract/scripts/generator.ts reads it.
const Ajv = ajvModule.default;

/** Problems with one environment file; an empty list means it validates. */
export function validateEnvironment(text: string, file: string, schema: object): string[] {
  const doc = parseDocument(text, { uniqueKeys: true });
  const [parseError] = doc.errors;
  if (parseError) return [`${file}: YAML does not parse (${parseError.code})`];
  if (doc.contents === null) return [`${file}: the document is empty`];

  const data: unknown = doc.toJS({ maxAliasCount: 0 });
  const problems = findLeaks(data).map((finding) => `${file}: ${finding}; the value is not shown`);

  const ajv = new Ajv({ allErrors: true });
  if (!ajv.validate(schema, data)) {
    for (const error of ajv.errors ?? []) {
      // The keyword and the location only: an error message can echo a value.
      problems.push(`${file}: ${error.instancePath || '(document)'} fails ${error.keyword}`);
    }
  }
  return problems;
}

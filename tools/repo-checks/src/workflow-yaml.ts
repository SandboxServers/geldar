import { parseAllDocuments } from 'yaml';

/** True for a GitHub Actions workflow file (`.github/workflows/*.yml` or `.yaml`). */
export function isWorkflowFile(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path);
}

/**
 * Parses a workflow with a real YAML parser and returns one message per
 * problem: a syntax error, or a duplicate mapping key (which GitHub rejects
 * and many loaders silently resolve to the last value).
 */
export function checkWorkflowYaml(path: string, text: string): string[] {
  const documents = parseAllDocuments(text, { uniqueKeys: true });
  const problems = documents.flatMap((doc) => doc.errors.map((e) => `${path}: ${e.message}`));
  if (documents.length > 1) problems.push(`${path}: a workflow must be a single YAML document`);
  return problems;
}

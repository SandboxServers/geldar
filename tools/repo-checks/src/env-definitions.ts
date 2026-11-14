/**
 * Every `envs/*.yaml` must validate against `envs/environment.schema.json` (the rules live
 * in tools/genesis-env). A schema that is missing or not JSON fails the gate when any
 * environment file exists, so the envs cannot be checked against nothing.
 */
import { validateEnvironment } from '@geldar/genesis-env';

export const ENV_SCHEMA = 'envs/environment.schema.json';
const ENV_FILE = /^envs\/[^/]+\.yaml$/;

export function checkEnvDefinitions(
  files: { path: string; text: string }[],
  schemaText: string | undefined,
): string[] {
  const envFiles = files.filter((file) => ENV_FILE.test(file.path));
  if (envFiles.length === 0) return [];
  if (schemaText === undefined) {
    return [`${ENV_SCHEMA} is missing; envs/*.yaml cannot be validated`];
  }
  let schema: object;
  try {
    schema = JSON.parse(schemaText) as object;
  } catch {
    return [`${ENV_SCHEMA} is not valid JSON`];
  }
  return envFiles.flatMap((file) => validateEnvironment(file.text, file.path, schema));
}

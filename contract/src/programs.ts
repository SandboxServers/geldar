/**
 * Validators for the explore, farm and patrol program shapes (decision 0344, AN-44). The shapes
 * live in schemas/program-shapes.schema.json; the generator exports validators only for a schema's
 * title and union members, so these compile the one schema on first use, not at import. Never throws.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ValidateFunction } from 'ajv';
import ajv2020Module from 'ajv/dist/2020.js';
import type {
  ExploreArguments,
  ExploreCheckpoint,
  ExploreDetail,
  FarmArguments,
  FarmCheckpoint,
  FarmDetail,
  PatrolArguments,
  PatrolCheckpoint,
  PatrolDetail,
} from './generated/types.ts';
import { formatError, type ValidationResult } from './validation.ts';

// ajv ships CommonJS with `exports.default` set; see generator.ts for the same interop.
const Ajv2020 = ajv2020Module.default;

const SHAPE_ID = 'https://geldar.dev/schemas/program-shapes.schema.json';
const schemaPath = fileURLToPath(new URL('../schemas/program-shapes.schema.json', import.meta.url));

// Built once, on the first validation: importing this module reads no file.
let ajv: InstanceType<typeof Ajv2020> | undefined;
const compiled = new Map<string, ValidateFunction>();

function shape(name: string): ValidateFunction {
  const known = compiled.get(name);
  if (known) return known;
  if (!ajv) {
    ajv = new Ajv2020({ strict: true, allErrors: true });
    // tsType is a json-schema-to-typescript annotation (types.ts), not a validation rule.
    ajv.addKeyword('tsType');
    ajv.addSchema(JSON.parse(readFileSync(schemaPath, 'utf8')));
  }
  const validate = ajv.getSchema(`${SHAPE_ID}#/$defs/${name}`);
  if (!validate)
    throw new Error(`program shape ${name} is missing from program-shapes.schema.json`);
  compiled.set(name, validate);
  return validate;
}

function check<T>(validate: ValidateFunction, value: unknown): ValidationResult<T> {
  if (validate(value)) return { ok: true, value: value as T };
  return { ok: false, errors: (validate.errors ?? []).map(formatError) };
}

/** Start arguments of explore. Unknown keys and out-of-bound values are invalid. */
export function validateExploreArguments(value: unknown): ValidationResult<ExploreArguments> {
  return check(shape('ExploreArguments'), value);
}

/** An explore checkpoint, as echoed back to resume(). */
export function validateExploreCheckpoint(value: unknown): ValidationResult<ExploreCheckpoint> {
  return check(shape('ExploreCheckpoint'), value);
}

/** The final detail of an explore run. */
export function validateExploreDetail(value: unknown): ValidationResult<ExploreDetail> {
  return check(shape('ExploreDetail'), value);
}

/** Start arguments of farm: a radius, never a position. */
export function validateFarmArguments(value: unknown): ValidationResult<FarmArguments> {
  return check(shape('FarmArguments'), value);
}

/** A farm checkpoint, as echoed back to resume(). */
export function validateFarmCheckpoint(value: unknown): ValidationResult<FarmCheckpoint> {
  return check(shape('FarmCheckpoint'), value);
}

/** The final detail of a farm run. */
export function validateFarmDetail(value: unknown): ValidationResult<FarmDetail> {
  return check(shape('FarmDetail'), value);
}

/** Start arguments of patrol: a route of 2 to 8 points. */
export function validatePatrolArguments(value: unknown): ValidationResult<PatrolArguments> {
  return check(shape('PatrolArguments'), value);
}

/** A patrol checkpoint, as echoed back to resume(). */
export function validatePatrolCheckpoint(value: unknown): ValidationResult<PatrolCheckpoint> {
  return check(shape('PatrolCheckpoint'), value);
}

/** The final detail of a patrol run. */
export function validatePatrolDetail(value: unknown): ValidationResult<PatrolDetail> {
  return check(shape('PatrolDetail'), value);
}

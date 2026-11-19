/**
 * Validators for the explore, farm and patrol program shapes (decision 0344, AN-44). The shapes
 * live in schemas/program-shapes.schema.json; the generator exports validators only for a schema's
 * title and union members, so these compile the one schema at load time. Never throws.
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
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(JSON.parse(readFileSync(schemaPath, 'utf8')));

function shape(name: string): ValidateFunction {
  const validate = ajv.getSchema(`${SHAPE_ID}#/$defs/${name}`);
  if (!validate)
    throw new Error(`program shape ${name} is missing from program-shapes.schema.json`);
  return validate;
}

function check<T>(validate: ValidateFunction, value: unknown): ValidationResult<T> {
  if (validate(value)) return { ok: true, value: value as T };
  return { ok: false, errors: (validate.errors ?? []).map(formatError) };
}

const exploreArguments = shape('ExploreArguments');
const exploreCheckpoint = shape('ExploreCheckpoint');
const exploreDetail = shape('ExploreDetail');
const farmArguments = shape('FarmArguments');
const farmCheckpoint = shape('FarmCheckpoint');
const farmDetail = shape('FarmDetail');
const patrolArguments = shape('PatrolArguments');
const patrolCheckpoint = shape('PatrolCheckpoint');
const patrolDetail = shape('PatrolDetail');

/** Start arguments of explore. Unknown keys and out-of-bound values are invalid. */
export function validateExploreArguments(value: unknown): ValidationResult<ExploreArguments> {
  return check(exploreArguments, value);
}

/** An explore checkpoint, as echoed back to resume(). */
export function validateExploreCheckpoint(value: unknown): ValidationResult<ExploreCheckpoint> {
  return check(exploreCheckpoint, value);
}

/** The final detail of an explore run. */
export function validateExploreDetail(value: unknown): ValidationResult<ExploreDetail> {
  return check(exploreDetail, value);
}

/** Start arguments of farm: a radius, never a position. */
export function validateFarmArguments(value: unknown): ValidationResult<FarmArguments> {
  return check(farmArguments, value);
}

/** A farm checkpoint, as echoed back to resume(). */
export function validateFarmCheckpoint(value: unknown): ValidationResult<FarmCheckpoint> {
  return check(farmCheckpoint, value);
}

/** The final detail of a farm run. */
export function validateFarmDetail(value: unknown): ValidationResult<FarmDetail> {
  return check(farmDetail, value);
}

/** Start arguments of patrol: a route of 2 to 8 points. */
export function validatePatrolArguments(value: unknown): ValidationResult<PatrolArguments> {
  return check(patrolArguments, value);
}

/** A patrol checkpoint, as echoed back to resume(). */
export function validatePatrolCheckpoint(value: unknown): ValidationResult<PatrolCheckpoint> {
  return check(patrolCheckpoint, value);
}

/** The final detail of a patrol run. */
export function validatePatrolDetail(value: unknown): ValidationResult<PatrolDetail> {
  return check(patrolDetail, value);
}

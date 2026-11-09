/** The embedding size of `nomic-embed-text` (decision D-P0-12), the width of `memories.embedding`. */
export const EMBEDDING_DIMS = 768;

/**
 * The pgvector text literal of a vector, for example `[0.1,0.2]`. It is bound as a parameter and
 * cast with `::vector` in the statement; no value is ever spliced into SQL. Throws when the length
 * differs from `dims` or a value is not a finite number.
 */
export function toVectorLiteral(vector: number[], dims: number = EMBEDDING_DIMS): string {
  if (vector.length !== dims) {
    throw new Error(`embedding has ${vector.length} numbers, expected ${dims}`);
  }
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error('embedding holds a value that is not a finite number');
    }
  }
  return `[${vector.join(',')}]`;
}

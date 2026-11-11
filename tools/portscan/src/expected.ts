export const MIN_PORT = 1;
export const MAX_PORT = 65535;

export interface PortRange {
  low: number;
  high: number;
}

function port(text: string, where: string): number {
  if (!/^\d+$/.test(text))
    throw new Error(`${where}: ${JSON.stringify(text)} is not a port number`);
  const value = Number(text);
  if (value < MIN_PORT || value > MAX_PORT) {
    throw new Error(`${where}: port ${value} is outside ${MIN_PORT} to ${MAX_PORT}`);
  }
  return value;
}

/** Parses `LOW-HIGH` (both inclusive). The whole range must be inside 1 to 65535 and LOW must not exceed HIGH. */
export function parseRange(text: string): PortRange {
  const match = /^(\d+)-(\d+)$/.exec(text.trim());
  if (match === null) throw new Error(`range ${JSON.stringify(text)} must look like LOW-HIGH`);
  const low = port(match[1] ?? '', 'range low');
  const high = port(match[2] ?? '', 'range high');
  if (low > high) throw new Error(`range ${text} has LOW above HIGH`);
  return { low, high };
}

/**
 * Parses the expected port list: a JSON array of port numbers, or whitespace or comma separated numbers.
 * Duplicates are refused. An empty file is refused, because an empty list must be written as `[]` on purpose.
 */
export function parseExpected(text: string): number[] {
  const trimmed = text.trim();
  if (trimmed === '') throw new Error('expected list is empty; write [] for no open ports');
  let tokens: string[];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'number')) {
      throw new Error('expected JSON must be an array of port numbers');
    }
    tokens = parsed.map((item) => String(item));
  } else {
    tokens = trimmed.split(/[\s,]+/);
  }
  const ports = tokens.map((token) => port(token, 'expected'));
  if (new Set(ports).size !== ports.length) throw new Error('expected list has a duplicate port');
  return ports.sort((a, b) => a - b);
}

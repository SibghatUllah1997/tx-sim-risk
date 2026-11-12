import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SCHEMA_RELATIVE = join('schema', 'report.schema.json');

/**
 * Locate `schema/report.schema.json` by walking parents of `start`.
 * Works from `src/`, `dist/`, and the E2E compile cache under
 * `node_modules/.cache`.
 */
export function defaultReportSchemaPath(start: string = __dirname): string {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, SCHEMA_RELATIVE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate ${SCHEMA_RELATIVE}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the report JSON Schema. Throws if the file is missing, not JSON,
 * or missing the keywords a consumer needs to identify it.
 */
export function loadReportSchema(
  path: string = defaultReportSchemaPath()
): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read schema ${path}: ${reason}`);
  }
  text = text.replace(/^\uFEFF/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Schema ${path} is not valid JSON: ${reason}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Schema ${path} must be a JSON object`);
  }
  if (typeof parsed.$id !== 'string' || !parsed.$id.trim()) {
    throw new Error(`Schema ${path} is missing $id`);
  }
  if (!Array.isArray(parsed.oneOf) || parsed.oneOf.length === 0) {
    throw new Error(`Schema ${path} must declare a non-empty oneOf`);
  }
  if (!isPlainObject(parsed.$defs)) {
    throw new Error(`Schema ${path} is missing $defs`);
  }
  return parsed;
}

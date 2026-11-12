import { loadReportSchema } from './schema';

export type SchemaIssue = {
  /** JSON pointer into the instance, or empty for the root. */
  path: string;
  message: string;
};

export type SchemaResult = {
  valid: boolean;
  errors: SchemaIssue[];
};

type EvalResult = {
  errors: SchemaIssue[];
  evaluatedProperties: Set<string>;
  evaluatedItems: Set<number>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pointer(base: string, key: string | number): string {
  const token = String(key).replace(/~/g, '~0').replace(/\//g, '~1');
  return `${base}/${token}`;
}

function unescapePointer(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveRef(root: unknown, ref: string): unknown {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const parts = ref.slice(2).split('/').map(unescapePointer);
  let current: unknown = root;
  for (const part of parts) {
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      throw new Error(`Unresolved $ref: ${ref}`);
    }
    current = current[part];
  }
  return current;
}

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  if (type === 'integer') {
    return typeof value === 'number' && Number.isInteger(value);
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return jsonType(value) === type;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null) return left === right;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, i) => deepEqual(item, right[i]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

function issue(path: string, message: string): SchemaIssue {
  return { path: path || '/', message };
}

function fail(path: string, message: string): EvalResult {
  return {
    errors: [issue(path, message)],
    evaluatedProperties: new Set(),
    evaluatedItems: new Set(),
  };
}

function emptyResult(): EvalResult {
  return {
    errors: [],
    evaluatedProperties: new Set(),
    evaluatedItems: new Set(),
  };
}

function mergeInto(target: EvalResult, child: EvalResult): void {
  target.errors.push(...child.errors);
  for (const key of child.evaluatedProperties) {
    target.evaluatedProperties.add(key);
  }
  for (const index of child.evaluatedItems) {
    target.evaluatedItems.add(index);
  }
}

function applySchema(
  instance: unknown,
  schema: unknown,
  path: string,
  root: unknown
): EvalResult {
  if (schema === true) return emptyResult();
  if (schema === false) {
    return fail(path, 'does not match a false schema');
  }
  if (!isPlainObject(schema)) {
    throw new Error(`Invalid JSON Schema at ${path || '/'}`);
  }

  const result = emptyResult();

  if (typeof schema.$ref === 'string') {
    mergeInto(
      result,
      applySchema(instance, resolveRef(root, schema.$ref), path, root)
    );
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.every((entry) => typeof entry === 'string')) {
      throw new Error(`Invalid type keyword at ${path || '/'}`);
    }
    if (!types.some((entry) => matchesType(instance, entry))) {
      result.errors.push(
        issue(path, `expected type ${types.join('|')}; got ${jsonType(instance)}`)
      );
    }
  }

  if (schema.const !== undefined && !deepEqual(instance, schema.const)) {
    result.errors.push(issue(path, `expected const ${JSON.stringify(schema.const)}`));
  }

  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((entry) => deepEqual(instance, entry))) {
      result.errors.push(issue(path, 'value is not listed in enum'));
    }
  }

  if (typeof instance === 'string') {
    if (
      typeof schema.minLength === 'number' &&
      instance.length < schema.minLength
    ) {
      result.errors.push(
        issue(path, `string shorter than minLength ${schema.minLength}`)
      );
    }
    if (
      typeof schema.maxLength === 'number' &&
      instance.length > schema.maxLength
    ) {
      result.errors.push(
        issue(path, `string longer than maxLength ${schema.maxLength}`)
      );
    }
    if (typeof schema.pattern === 'string') {
      const pattern = new RegExp(schema.pattern, 'u');
      if (!pattern.test(instance)) {
        result.errors.push(issue(path, `string does not match ${schema.pattern}`));
      }
    }
  }

  if (typeof instance === 'number') {
    if (typeof schema.minimum === 'number' && instance < schema.minimum) {
      result.errors.push(issue(path, `number below minimum ${schema.minimum}`));
    }
    if (typeof schema.maximum === 'number' && instance > schema.maximum) {
      result.errors.push(issue(path, `number above maximum ${schema.maximum}`));
    }
  }

  if (Array.isArray(instance)) {
    if (typeof schema.minItems === 'number' && instance.length < schema.minItems) {
      result.errors.push(
        issue(path, `array shorter than minItems ${schema.minItems}`)
      );
    }
    if (typeof schema.maxItems === 'number' && instance.length > schema.maxItems) {
      result.errors.push(
        issue(path, `array longer than maxItems ${schema.maxItems}`)
      );
    }
    if (schema.uniqueItems === true) {
      for (let i = 0; i < instance.length; i++) {
        for (let j = i + 1; j < instance.length; j++) {
          if (deepEqual(instance[i], instance[j])) {
            result.errors.push(issue(path, 'array items are not unique'));
            i = instance.length;
            break;
          }
        }
      }
    }

    const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : [];
    prefix.forEach((itemSchema, index) => {
      if (index >= instance.length) return;
      result.evaluatedItems.add(index);
      mergeInto(
        result,
        applySchema(instance[index], itemSchema, pointer(path, index), root)
      );
    });
    if ('items' in schema) {
      for (let index = prefix.length; index < instance.length; index++) {
        result.evaluatedItems.add(index);
        mergeInto(
          result,
          applySchema(instance[index], schema.items, pointer(path, index), root)
        );
      }
    }
  }

  if (isPlainObject(instance)) {
    const keys = Object.keys(instance);
    if (
      typeof schema.minProperties === 'number' &&
      keys.length < schema.minProperties
    ) {
      result.errors.push(
        issue(
          path,
          `object has fewer than minProperties ${schema.minProperties}`
        )
      );
    }
    if (
      typeof schema.maxProperties === 'number' &&
      keys.length > schema.maxProperties
    ) {
      result.errors.push(
        issue(
          path,
          `object has more than maxProperties ${schema.maxProperties}`
        )
      );
    }

    if (Array.isArray(schema.required)) {
      for (const name of schema.required) {
        if (typeof name !== 'string') continue;
        if (!Object.prototype.hasOwnProperty.call(instance, name)) {
          result.errors.push(issue(path, `missing required property ${name}`));
        }
      }
    }

    const defined = new Set<string>();
    if (isPlainObject(schema.properties)) {
      for (const [key, subschema] of Object.entries(schema.properties)) {
        defined.add(key);
        if (!Object.prototype.hasOwnProperty.call(instance, key)) continue;
        result.evaluatedProperties.add(key);
        mergeInto(
          result,
          applySchema(instance[key], subschema, pointer(path, key), root)
        );
      }
    }

    if ('additionalProperties' in schema) {
      for (const key of keys) {
        if (defined.has(key)) continue;
        result.evaluatedProperties.add(key);
        mergeInto(
          result,
          applySchema(
            instance[key],
            schema.additionalProperties,
            pointer(path, key),
            root
          )
        );
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      mergeInto(result, applySchema(instance, sub, path, root));
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const successes: EvalResult[] = [];
    for (const sub of schema.anyOf) {
      const child = applySchema(instance, sub, path, root);
      if (child.errors.length === 0) successes.push(child);
    }
    if (successes.length === 0) {
      result.errors.push(
        issue(path, `did not match any of ${schema.anyOf.length} anyOf schemas`)
      );
    } else {
      for (const child of successes) mergeInto(result, child);
    }
  }

  if (Array.isArray(schema.oneOf)) {
    const successes: EvalResult[] = [];
    for (const sub of schema.oneOf) {
      const child = applySchema(instance, sub, path, root);
      if (child.errors.length === 0) successes.push(child);
    }
    if (successes.length !== 1) {
      result.errors.push(
        issue(
          path,
          `expected exactly one of ${schema.oneOf.length} oneOf schemas to match; matched ${successes.length}`
        )
      );
    } else {
      mergeInto(result, successes[0]!);
    }
  }

  if ('not' in schema) {
    const child = applySchema(instance, schema.not, path, root);
    if (child.errors.length === 0) {
      result.errors.push(issue(path, 'matched a not schema'));
    }
  }

  if ('if' in schema) {
    const condition = applySchema(instance, schema.if, path, root);
    if (condition.errors.length === 0) {
      mergeInto(result, condition);
      if ('then' in schema) {
        mergeInto(result, applySchema(instance, schema.then, path, root));
      }
    } else if ('else' in schema) {
      mergeInto(result, applySchema(instance, schema.else, path, root));
    }
  }

  if (isPlainObject(instance) && 'unevaluatedProperties' in schema) {
    for (const key of Object.keys(instance)) {
      if (result.evaluatedProperties.has(key)) continue;
      result.evaluatedProperties.add(key);
      mergeInto(
        result,
        applySchema(
          instance[key],
          schema.unevaluatedProperties,
          pointer(path, key),
          root
        )
      );
    }
  }

  if (Array.isArray(instance) && 'unevaluatedItems' in schema) {
    for (let index = 0; index < instance.length; index++) {
      if (result.evaluatedItems.has(index)) continue;
      result.evaluatedItems.add(index);
      mergeInto(
        result,
        applySchema(
          instance[index],
          schema.unevaluatedItems,
          pointer(path, index),
          root
        )
      );
    }
  }

  return result;
}

/**
 * Validate `instance` against a JSON Schema (Draft 2020-12 subset used by
 * the report schema: type/enum/const, properties, additionalProperties,
 * unevaluatedProperties, items/prefixItems, combinators, and $ref).
 */
export function validateJsonSchema(
  instance: unknown,
  schema: unknown,
  root: unknown = schema
): SchemaResult {
  const evaluated = applySchema(instance, schema, '', root);
  return { valid: evaluated.errors.length === 0, errors: evaluated.errors };
}

/** True when `report` matches the shipped report JSON Schema. */
export function isValidReport(
  report: unknown,
  schema: unknown = loadReportSchema()
): boolean {
  return validateJsonSchema(report, schema).valid;
}

/**
 * Throw if `report` does not match the shipped report JSON Schema.
 * The error lists JSON-pointer paths so a mismatch is easy to locate.
 */
export function assertValidReport(
  report: unknown,
  schema: unknown = loadReportSchema()
): void {
  const result = validateJsonSchema(report, schema);
  if (result.valid) return;
  const detail = result.errors
    .slice(0, 8)
    .map((entry) => `${entry.path} ${entry.message}`)
    .join('; ');
  throw new Error(`Report does not match schema: ${detail}`);
}

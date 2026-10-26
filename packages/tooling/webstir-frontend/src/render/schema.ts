export interface SchemaLike {
  readonly _zod: { readonly def: Record<string, unknown> & { readonly type: string } };
}

export type SchemaResult = { readonly ok: readonly SchemaLike[] } | { readonly error: string };

const ANY: SchemaLike = { _zod: { def: { type: 'any' } } };
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'catch',
  'readonly',
  'nonoptional',
]);
const NULLISH = new Set(['null', 'undefined', 'void']);
const OPEN = new Set(['any', 'unknown', 'custom']);
const TEXT = new Set(['string', 'number', 'bigint', 'enum']);

const KIND_NAMES: Record<string, string> = {
  object: 'an object',
  record: 'an object',
  array: 'an array',
  tuple: 'an array',
  set: 'a set',
  map: 'a map',
  string: 'a string',
  number: 'a number',
  bigint: 'a number',
  boolean: 'a boolean',
  date: 'a date',
  enum: 'a string',
  null: 'null',
  undefined: 'undefined',
  void: 'undefined',
  function: 'a function',
  promise: 'a promise',
  symbol: 'a symbol',
  never: 'never',
};

export function isSchemaLike(value: unknown): value is SchemaLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SchemaLike)._zod === 'object' &&
    typeof (value as SchemaLike)._zod?.def?.type === 'string'
  );
}

export function flattenSchema(schema: SchemaLike): SchemaLike[] {
  const leaves: SchemaLike[] = [];
  collect(schema, leaves, new Set());
  return leaves;
}

/** Whether an object schema names this key itself, not just accepts any key. */
export function declaresKey(candidates: readonly SchemaLike[], key: string): boolean {
  return candidates.some(
    (candidate) => typeNameOf(candidate) === 'object' && key in objectShape(candidate),
  );
}

export function lookupKey(candidates: readonly SchemaLike[], key: string): SchemaResult {
  const found: SchemaLike[] = [];
  const known = new Set<string>();
  const kinds = new Set<string>();

  for (const candidate of candidates) {
    const typeName = typeNameOf(candidate);
    if (OPEN.has(typeName)) {
      found.push(ANY);
    } else if (typeName === 'object') {
      const shape = objectShape(candidate);
      const field = shape[key];
      if (field) {
        found.push(...flattenSchema(field));
      } else if (hasOpenKeys(candidate)) {
        found.push(ANY);
      } else {
        for (const name of Object.keys(shape)) {
          known.add(name);
        }
      }
    } else if (typeName === 'record') {
      found.push(...flattenSchema(candidate._zod.def.valueType as SchemaLike));
    } else if (!NULLISH.has(typeName)) {
      kinds.add(describe(candidate));
    }
  }

  if (found.length > 0) {
    return { ok: found };
  }
  if (known.size > 0) {
    return { error: `has no \`${key}\`; it has ${formatKeys(known)}` };
  }
  if (kinds.size > 0) {
    return { error: `is ${[...kinds].join(' or ')}, which has no \`${key}\`` };
  }
  return { error: 'is always empty' };
}

export function elementOf(candidates: readonly SchemaLike[]): SchemaResult {
  const found: SchemaLike[] = [];
  const kinds = new Set<string>();

  for (const candidate of candidates) {
    const typeName = typeNameOf(candidate);
    if (OPEN.has(typeName)) {
      found.push(ANY);
    } else if (typeName === 'array') {
      found.push(...flattenSchema(candidate._zod.def.element as SchemaLike));
    } else if (typeName === 'set') {
      // A parsed set is a Set, not an array, and the renderer loops over arrays only.
      kinds.add('a set (use z.array)');
    } else if (typeName === 'tuple') {
      for (const item of candidate._zod.def.items as SchemaLike[]) {
        found.push(...flattenSchema(item));
      }
      if (isSchemaLike(candidate._zod.def.rest)) {
        found.push(...flattenSchema(candidate._zod.def.rest));
      }
    } else if (!NULLISH.has(typeName)) {
      kinds.add(describe(candidate));
    }
  }

  if (kinds.size > 0) {
    return { error: `needs an array, but it can be ${[...kinds].join(' or ')}` };
  }
  if (found.length === 0) {
    return { error: 'needs an array, but it is always empty' };
  }
  return { ok: found };
}

export function checkText(candidates: readonly SchemaLike[]): string | undefined {
  return checkScalar(candidates, false);
}

export function checkAttribute(candidates: readonly SchemaLike[]): string | undefined {
  return checkScalar(candidates, true);
}

function checkScalar(candidates: readonly SchemaLike[], allowBoolean: boolean): string | undefined {
  const kinds = new Set<string>();
  for (const candidate of candidates) {
    const typeName = typeNameOf(candidate);
    if (OPEN.has(typeName) || NULLISH.has(typeName) || TEXT.has(typeName)) {
      continue;
    }
    if (typeName === 'boolean' && allowBoolean) {
      continue;
    }
    if (typeName === 'literal') {
      const values = candidate._zod.def.values as unknown[];
      const allowed = values.every(
        (value) =>
          value === null ||
          value === undefined ||
          ['string', 'number', 'bigint'].includes(typeof value) ||
          (allowBoolean && typeof value === 'boolean'),
      );
      if (allowed) continue;
    }
    kinds.add(describe(candidate));
  }
  if (kinds.size === 0) {
    return undefined;
  }
  const expected = allowBoolean ? 'a string, number or boolean' : 'a string or number';
  return `needs ${expected}, but it can be ${[...kinds].join(' or ')}`;
}

function collect(schema: SchemaLike, leaves: SchemaLike[], seen: Set<SchemaLike>): void {
  if (!isSchemaLike(schema)) {
    throw new Error('Expected a Zod 4 schema.');
  }
  if (seen.has(schema)) {
    return;
  }
  seen.add(schema);

  const def = schema._zod.def;
  const typeName = typeNameOf(schema);
  if (WRAPPERS.has(typeName)) {
    collect(def.innerType as SchemaLike, leaves, seen);
  } else if (typeName === 'lazy') {
    collect((def.getter as () => SchemaLike)(), leaves, seen);
  } else if (typeName === 'pipe') {
    collect(def.out as SchemaLike, leaves, seen);
  } else if (typeName === 'transform') {
    leaves.push(ANY);
  } else if (typeName === 'union') {
    const options = def.options as Iterable<SchemaLike>;
    for (const option of options) {
      collect(option, leaves, seen);
    }
  } else if (typeName === 'intersection') {
    collect(def.left as SchemaLike, leaves, seen);
    collect(def.right as SchemaLike, leaves, seen);
  } else {
    leaves.push(schema);
  }
}

function objectShape(schema: SchemaLike): Record<string, SchemaLike> {
  const shape = schema._zod.def.shape;
  return (typeof shape === 'function' ? shape() : shape) as Record<string, SchemaLike>;
}

function hasOpenKeys(schema: SchemaLike): boolean {
  const catchall = schema._zod.def.catchall;
  if (isSchemaLike(catchall) && typeNameOf(catchall) !== 'never') {
    return true;
  }
  return false;
}

function typeNameOf(schema: SchemaLike): string {
  return schema._zod.def.type;
}

function describe(schema: SchemaLike): string {
  const typeName = typeNameOf(schema);
  if (typeName === 'literal') {
    const values = schema._zod.def.values as unknown[];
    const rendered = values.map((value) =>
      typeof value === 'bigint' ? `${value}n` : String(JSON.stringify(value)),
    );
    return `the literal ${values.length === 1 ? rendered[0] : `[${rendered.join(', ')}]`}`;
  }
  return KIND_NAMES[typeName] ?? typeName.replace(/^Zod/, '').toLowerCase();
}

function formatKeys(keys: ReadonlySet<string>): string {
  const sorted = [...keys].sort().map((key) => `\`${key}\``);
  return sorted.length === 0 ? 'no keys' : sorted.join(', ');
}

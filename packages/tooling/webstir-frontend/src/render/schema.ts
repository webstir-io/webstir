export interface SchemaLike {
  readonly _def: Record<string, unknown> & { readonly typeName?: string };
}

export type SchemaResult = { readonly ok: readonly SchemaLike[] } | { readonly error: string };

const ANY: SchemaLike = { _def: { typeName: 'ZodAny' } };
const WRAPPERS = new Set(['ZodOptional', 'ZodNullable', 'ZodDefault', 'ZodCatch', 'ZodReadonly']);
const NULLISH = new Set(['ZodNull', 'ZodUndefined', 'ZodVoid']);
const OPEN = new Set(['ZodAny', 'ZodUnknown']);
const TEXT = new Set(['ZodString', 'ZodNumber', 'ZodBigInt', 'ZodEnum', 'ZodNativeEnum']);

const KIND_NAMES: Record<string, string> = {
  ZodObject: 'an object',
  ZodRecord: 'an object',
  ZodArray: 'an array',
  ZodTuple: 'an array',
  ZodSet: 'a set',
  ZodMap: 'a map',
  ZodString: 'a string',
  ZodNumber: 'a number',
  ZodBigInt: 'a number',
  ZodBoolean: 'a boolean',
  ZodDate: 'a date',
  ZodEnum: 'a string',
  ZodNativeEnum: 'an enum',
  ZodNull: 'null',
  ZodUndefined: 'undefined',
  ZodVoid: 'undefined',
  ZodFunction: 'a function',
  ZodPromise: 'a promise',
  ZodSymbol: 'a symbol',
  ZodNever: 'never',
};

export function isSchemaLike(value: unknown): value is SchemaLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SchemaLike)._def === 'object' &&
    typeof (value as SchemaLike)._def?.typeName === 'string'
  );
}

export function flattenSchema(schema: SchemaLike): SchemaLike[] {
  const leaves: SchemaLike[] = [];
  collect(schema, leaves, new Set());
  return leaves;
}

export function lookupKey(candidates: readonly SchemaLike[], key: string): SchemaResult {
  const found: SchemaLike[] = [];
  const known = new Set<string>();
  const kinds = new Set<string>();

  for (const candidate of candidates) {
    const typeName = typeNameOf(candidate);
    if (OPEN.has(typeName)) {
      found.push(ANY);
    } else if (typeName === 'ZodObject') {
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
    } else if (typeName === 'ZodRecord') {
      found.push(...flattenSchema(candidate._def.valueType as SchemaLike));
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
    } else if (typeName === 'ZodArray') {
      found.push(...flattenSchema(candidate._def.type as SchemaLike));
    } else if (typeName === 'ZodSet') {
      // A parsed set is a Set, not an array, and the renderer loops over arrays only.
      kinds.add('a set (use z.array)');
    } else if (typeName === 'ZodTuple') {
      for (const item of candidate._def.items as SchemaLike[]) {
        found.push(...flattenSchema(item));
      }
      if (isSchemaLike(candidate._def.rest)) {
        found.push(...flattenSchema(candidate._def.rest));
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
    if (typeName === 'ZodBoolean' && allowBoolean) {
      continue;
    }
    if (typeName === 'ZodLiteral') {
      const value = candidate._def.value;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
        continue;
      }
      if (typeof value === 'boolean' && allowBoolean) {
        continue;
      }
      if (value === null || value === undefined) {
        continue;
      }
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
    leaves.push(ANY);
    return;
  }
  if (seen.has(schema)) {
    return;
  }
  seen.add(schema);

  const def = schema._def;
  const typeName = typeNameOf(schema);
  if (WRAPPERS.has(typeName)) {
    collect(def.innerType as SchemaLike, leaves, seen);
  } else if (typeName === 'ZodBranded') {
    collect(def.type as SchemaLike, leaves, seen);
  } else if (typeName === 'ZodLazy') {
    collect((def.getter as () => SchemaLike)(), leaves, seen);
  } else if (typeName === 'ZodPipeline') {
    collect(def.out as SchemaLike, leaves, seen);
  } else if (typeName === 'ZodEffects') {
    const effect = def.effect as { type?: string } | undefined;
    if (effect?.type === 'transform') {
      leaves.push(ANY);
    } else {
      collect(def.schema as SchemaLike, leaves, seen);
    }
  } else if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
    const options = def.options as Iterable<SchemaLike>;
    for (const option of options) {
      collect(option, leaves, seen);
    }
  } else if (typeName === 'ZodIntersection') {
    collect(def.left as SchemaLike, leaves, seen);
    collect(def.right as SchemaLike, leaves, seen);
  } else {
    leaves.push(schema);
  }
}

function objectShape(schema: SchemaLike): Record<string, SchemaLike> {
  const shape = schema._def.shape;
  return (typeof shape === 'function' ? shape() : shape) as Record<string, SchemaLike>;
}

function hasOpenKeys(schema: SchemaLike): boolean {
  const catchall = schema._def.catchall;
  if (isSchemaLike(catchall) && typeNameOf(catchall) !== 'ZodNever') {
    return true;
  }
  return schema._def.unknownKeys === 'passthrough';
}

function typeNameOf(schema: SchemaLike): string {
  return schema._def.typeName ?? 'ZodUnknown';
}

function describe(schema: SchemaLike): string {
  const typeName = typeNameOf(schema);
  if (typeName === 'ZodLiteral') {
    return `the literal ${JSON.stringify(schema._def.value)}`;
  }
  return KIND_NAMES[typeName] ?? typeName.replace(/^Zod/, '').toLowerCase();
}

function formatKeys(keys: ReadonlySet<string>): string {
  const sorted = [...keys].sort().map((key) => `\`${key}\``);
  return sorted.length === 0 ? 'no keys' : sorted.join(', ');
}

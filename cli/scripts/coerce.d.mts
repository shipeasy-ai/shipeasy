// Types for the plain-JS generator helper. Kept beside coerce.mjs so tsc
// resolves the declaration instead of pulling the .mjs into the src rootDir.

/** Schema fragments here are raw OpenAPI JSON — deliberately untyped. */
type Schema = Record<string, any>;

/** The CLI coercion helpers emitted into commands.gen.ts. */
export type Coercion = "str" | "num" | "bool" | "json";

export declare const scalarType: (b: Schema) => string | null;

export declare const makeCoercer: (
  deref: (o: Schema) => Schema,
) => (schema: Schema) => Coercion;

// Pick the CLI coercion helper (`str`/`num`/`bool`/`list`/`json`) for a query param or
// body-property schema. Extracted from gen-commands.mjs so it can be unit
// tested: a wrong pick here doesn't break the build, it breaks the flag at
// runtime — `--type bug` once coerced through json() and died on JSON.parse.

/**
 * The scalar a schema puts on the wire, or null when it isn't a plain scalar.
 * `const`/`enum` branches often carry no explicit `type`, so fall back to the
 * values themselves. `integer` normalizes to `number` — both coerce with num().
 */
export const scalarType = (b) => {
  const t = Array.isArray(b.type) ? b.type.find((x) => x !== "null") : b.type;
  if (t) return t === "integer" ? "number" : t;
  const vals = b.const !== undefined ? [b.const] : b.enum;
  if (!Array.isArray(vals) || vals.length === 0) return null;
  const kinds = new Set(vals.filter((v) => v !== null).map((v) => typeof v));
  return kinds.size === 1 ? [...kinds][0] : null;
};

/**
 * True for an array item that is a short, comma-free TOKEN — a tag name, an
 * email, an enum value — so the flag can take a comma list
 * (`--tags ios,checkout`) as well as a JSON array. Free-text items (steps, option
 * labels) can carry commas themselves, so they stay JSON-only.
 */
export const isTokenList = (item) =>
  scalarType(item) === "string" &&
  (item.format !== undefined ||
    item.enum !== undefined ||
    item.const !== undefined ||
    (typeof item.maxLength === "number" && item.maxLength <= 64));

/** Build the coercer, bound to the spec-aware `$ref` resolver. */
export const makeCoercer =
  (deref) =>
  (schema) => {
    let s = deref(schema) ?? {};
    // unwrap a nullable union ([{type:X},{type:null}]) to its single real branch
    const union = s.anyOf || s.oneOf;
    if (union) {
      const real = union
        .map(deref)
        .filter((b) => (Array.isArray(b.type) ? !b.type.includes("null") : b.type !== "null"));
      if (real.length === 1) s = real[0];
      else {
        // A union whose branches are all the SAME scalar is still that scalar on
        // the wire — `enum[bug,…] | const "all"` is just a string. Falling
        // through to "json" here made `--type bug` die with
        // `expected JSON, got "bug"`, since JSON.parse of a bare word throws.
        // Only a genuinely mixed union (or one of objects/arrays) needs --data.
        const kinds = new Set(real.map(scalarType));
        if (kinds.size === 1 && !kinds.has(null)) s = { type: [...kinds][0] };
        else return "json";
      }
    }
    if (s.allOf) return "json";
    const t = Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type;
    if (t === "integer" || t === "number") return "num";
    if (t === "boolean") return "bool";
    if (t === "array" && isTokenList(deref(s.items) ?? {})) return "list";
    if (t === "array" || t === "object") return "json";
    return "str";
  };

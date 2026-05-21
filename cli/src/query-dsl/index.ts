// Vendored subset of @shipeasy/query-dsl: IR types + parse + render.
//
// The CLI only converts CLI args into the IR JSON shape that the admin API
// accepts and stores. Compile/registry/SQL rendering live in the worker
// (private). This subset is small enough to vendor; the OpenAPI spec is
// the canonical source-of-truth for the IR shape itself.

export * from "./ir";
export { parse, ParseError } from "./parse";
export { render } from "./render";

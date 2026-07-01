/**
 * `@shipeasy/openapi/node-context` — the shared node-only fs helpers used by the
 * CLI and MCP binaries (the `.shipeasy` project-binding file). Keep this subpath
 * out of the worker-bundled graph: the root and `./custom` entries stay fs-free.
 */
export * from "./project-config.js";

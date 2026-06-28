import { grammarOp } from "./grammar.js";
import { docsOps } from "./docs.js";
import type { CustomOp } from "./types.js";

export type { CustomOp, CustomParam, CustomParamType } from "./types.js";
export { CustomOpError, opId } from "./types.js";
export { METRIC_GRAMMAR } from "./grammar.js";

/**
 * Every custom (non-spec) operation, in surface order. The CLI and MCP each
 * project this with a thin adapter so the sugar commands stay in sync.
 */
export const customOperations: CustomOp[] = [grammarOp, ...docsOps];

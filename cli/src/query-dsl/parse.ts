// Hand-rolled tokenizer + recursive-descent parser for the metric DSL.
//
// Grammar (BNF):
//
//   Query       := AggFunc "(" Selector ("," Identifier)? ")" GroupBy?
//   AggFunc     := "count_users" | "count" | "sum" | "avg" | "min" | "max" |
//                  "unique" | "p50" | "p75" | "p90" | "p95" | "p99" | "p999" |
//                  "retention_" Number "d"
//   Selector    := Identifier ("{" Filter ("," Filter)* ","? "}")?
//   Filter      := Identifier MatchOp StringLiteral
//   MatchOp     := "=" | "!=" | "=~" | "!~"
//   StringLiteral := '"' ([^"\\] | "\\" .)* '"'
//   GroupBy     := ("by" | "without") "(" Identifier ("," Identifier)* ","? ")"
//   Identifier  := [A-Za-z_][A-Za-z0-9_]*
//
// Anything outside this grammar is a ParseError. There is no arithmetic, no
// arbitrary quantiles, no subqueries.

import type { AggKind, Filter, GroupBy, MatchOp, Query } from "./ir";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(`${message} (at position ${position})`);
  }
}

type Token =
  | { kind: "ident"; value: string; pos: number }
  | { kind: "string"; value: string; pos: number }
  | { kind: "punct"; value: "(" | ")" | "{" | "}" | ","; pos: number }
  | { kind: "op"; value: MatchOp; pos: number };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "{" || ch === "}" || ch === ",") {
      tokens.push({ kind: "punct", value: ch as "(", pos: i });
      i++;
      continue;
    }
    if (ch === "=") {
      if (input[i + 1] === "~") {
        tokens.push({ kind: "op", value: "=~", pos: i });
        i += 2;
      } else {
        tokens.push({ kind: "op", value: "=", pos: i });
        i++;
      }
      continue;
    }
    if (ch === "!") {
      if (input[i + 1] === "=") {
        tokens.push({ kind: "op", value: "!=", pos: i });
        i += 2;
      } else if (input[i + 1] === "~") {
        tokens.push({ kind: "op", value: "!~", pos: i });
        i += 2;
      } else {
        throw new ParseError(`Unexpected '!' (only '!=' / '!~' allowed)`, i);
      }
      continue;
    }
    if (ch === '"') {
      const start = i;
      i++;
      let value = "";
      while (i < input.length) {
        const c = input[i];
        if (c === "\\") {
          if (i + 1 >= input.length) throw new ParseError("Unterminated escape", i);
          value += input[i + 1];
          i += 2;
          continue;
        }
        if (c === '"') {
          tokens.push({ kind: "string", value, pos: start });
          i++;
          break;
        }
        value += c;
        i++;
        if (i >= input.length) throw new ParseError("Unterminated string", start);
      }
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
      tokens.push({ kind: "ident", value: input.slice(i, j), pos: i });
      i = j;
      continue;
    }
    throw new ParseError(`Unexpected character '${ch}'`, i);
  }
  return tokens;
}

const QUANTILE_MAP: Record<string, 0.5 | 0.75 | 0.9 | 0.95 | 0.99 | 0.999> = {
  p50: 0.5,
  p75: 0.75,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
  p999: 0.999,
};

function parseAggName(name: string, pos: number): AggKind {
  if (name === "count_users") return { kind: "count_users" };
  if (name === "count") return { kind: "count_events" };
  if (name === "sum") return { kind: "sum" };
  if (name === "avg") return { kind: "avg" };
  if (name === "min") return { kind: "min" };
  if (name === "max") return { kind: "max" };
  if (name === "unique") return { kind: "unique" };
  if (name in QUANTILE_MAP) return { kind: "quantile", p: QUANTILE_MAP[name] };
  const ret = /^retention_(\d{1,2})d$/.exec(name);
  if (ret) {
    const n = Number(ret[1]);
    if (!(n >= 1 && n <= 90)) {
      throw new ParseError(`retention_${n}d out of range (1-90)`, pos);
    }
    return { kind: "retention_Nd", n };
  }
  throw new ParseError(`Unknown aggregation '${name}'`, pos);
}

export function parse(input: string): Query {
  const tokens = tokenize(input);
  let p = 0;

  function peek(): Token | undefined {
    return tokens[p];
  }
  function eat(): Token {
    const t = tokens[p];
    if (!t) throw new ParseError("Unexpected end of input", input.length);
    p++;
    return t;
  }
  function expectPunct(v: "(" | ")" | "{" | "}" | ","): Token {
    const t = eat();
    if (t.kind !== "punct" || t.value !== v) {
      throw new ParseError(`Expected '${v}'`, t.pos);
    }
    return t;
  }
  function expectIdent(label: string): string {
    const t = eat();
    if (t.kind !== "ident") throw new ParseError(`Expected ${label}`, t.pos);
    return t.value;
  }

  const aggTok = eat();
  if (aggTok.kind !== "ident") throw new ParseError("Expected aggregation name", aggTok.pos);
  const agg = parseAggName(aggTok.value, aggTok.pos);

  expectPunct("(");
  const metric = expectIdent("metric name");

  const filters: Filter[] = [];
  if (peek()?.kind === "punct" && peek()?.value === "{") {
    eat();
    while (peek()?.kind !== "punct" || peek()?.value !== "}") {
      const label = expectIdent("filter label");
      const opTok = eat();
      if (opTok.kind !== "op") throw new ParseError("Expected match operator", opTok.pos);
      const valTok = eat();
      if (valTok.kind !== "string")
        throw new ParseError("Filter value must be a quoted string", valTok.pos);
      filters.push({ label, op: opTok.value, value: valTok.value });
      const sep = peek();
      if (sep?.kind === "punct" && sep.value === ",") {
        eat();
      } else if (sep?.kind === "punct" && sep.value === "}") {
        break;
      } else {
        throw new ParseError("Expected ',' or '}'", sep?.pos ?? input.length);
      }
    }
    expectPunct("}");
  }

  let valueLabel: string | undefined;
  if (peek()?.kind === "punct" && peek()?.value === ",") {
    eat();
    valueLabel = expectIdent("value label");
  }
  expectPunct(")");

  let groupBy: GroupBy | undefined;
  const gbTok = peek();
  if (gbTok?.kind === "ident" && (gbTok.value === "by" || gbTok.value === "without")) {
    const op = (eat() as { value: string }).value as "by" | "without";
    expectPunct("(");
    const labels: string[] = [];
    while (true) {
      labels.push(expectIdent("groupBy label"));
      const sep = peek();
      if (sep?.kind === "punct" && sep.value === ",") {
        eat();
        const peeked = peek();
        if (peeked?.kind === "punct" && peeked.value === ")") break;
        continue;
      }
      break;
    }
    expectPunct(")");
    groupBy = { op, labels };
  }

  if (p < tokens.length) {
    throw new ParseError(`Trailing tokens after query`, tokens[p].pos);
  }
  return { agg, metric, valueLabel, filters, groupBy };
}

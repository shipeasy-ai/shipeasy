import type { Command } from "commander";
import { parse, render, type Query } from "../query-dsl";
import { getApiClient, ApiError } from "../api/client";
import { printJson, printTable } from "../util/output";
import { withExamples } from "../util/examples";

type MetricRow = {
  id: string;
  name: string;
  folder: string | null;
  eventName: string;
  aggregation: string;
  valuePath: string | null;
  queryIr?: unknown;
};

const GRAMMAR = `Shipeasy metric query DSL
=========================

Query        := AggFunc "(" Selector ("," Identifier)? ")" GroupBy?
AggFunc      := count_users | count | sum | avg | min | max | unique |
                p50 | p75 | p90 | p95 | p99 | p999 |
                retention_<N>d            (N in 1..90)
Selector     := Identifier ("{" Filter ("," Filter)* ","? "}")?
Filter       := Identifier MatchOp StringLiteral
MatchOp      := "=" | "!=" | "=~" | "!~"
StringLiteral := double-quoted, supports \\" and \\\\
GroupBy      := ("by" | "without") "(" Identifier ("," Identifier)* ","? ")"

Examples
--------
  count_users(checkout_completed)
  sum(purchase{country="US"}, amount)
  p99(req_dur{route=~"/api/.*"}, ms) by (route, status)
  retention_7d(session_start)
  avg(req_dur{tier!="free"}, ms) without (region)

Notes
-----
- One event selector per query (no formulas).
- "count" maps to count_events (per-row count); "count_users" is uniq-by-user.
- For experiments, "by (label)" is ignored — per-user reducer is applied.
- Filter values must be quoted strings, even for numeric labels (they are coerced).
- Filter labels and value labels must be declared on the source event.
`;

export function metricsCommand(program: Command): void {
  const cmd = program.command("metrics").description("Manage event metrics");

  const grammarCmd = cmd
    .command("grammar")
    .description("Print the metric query DSL grammar")
    .action(() => {
      process.stdout.write(GRAMMAR);
    });

  withExamples(grammarCmd, [{ run: "shipeasy metrics grammar" }]);

  const listCmd = cmd
    .command("list")
    .description("List metrics in the bound project")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const api = getApiClient();
        const rows = await api.request<MetricRow[]>("GET", "/api/admin/metrics");
        if (opts.json) return printJson(rows);
        printTable(
          ["ID", "Name", "Folder", "Event", "Agg", "Query"],
          rows.map((m) => [
            m.id.slice(0, 8),
            m.name,
            m.folder ?? "—",
            m.eventName,
            m.aggregation,
            (() => {
              try {
                return m.queryIr ? render(m.queryIr as Query) : "—";
              } catch {
                return "—";
              }
            })(),
          ]),
        );
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(listCmd, [{ run: "shipeasy metrics list" }]);

  const showCmd = cmd
    .command("show <id>")
    .description("Show one metric")
    .option("--json", "Output JSON")
    .action(async (id: string, opts: { json?: boolean }) => {
      try {
        const api = getApiClient();
        const m = await api.request<MetricRow>("GET", `/api/admin/metrics/${id}`);
        if (opts.json) return printJson(m);
        console.log(`Name:    ${m.name}`);
        console.log(`Folder:  ${m.folder ?? "—"}`);
        console.log(`Event:   ${m.eventName}`);
        console.log(`Agg:     ${m.aggregation}`);
        if (m.queryIr) {
          try {
            console.log(`Query:   ${render(m.queryIr as Query)}`);
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(showCmd, [{ run: "shipeasy metrics show 3f9a2c1b" }]);

  const createCmd = cmd
    .command("create <name>")
    .description("Create a metric. Pass the DSL via --query, or pass --query-ir for the typed form.")
    .requiredOption("--event <name>", "Source event name")
    .option("--query <dsl>", "Query DSL string, e.g. 'sum(purchase, amount)'")
    .option("--query-ir <json>", "Typed IR JSON (alternative to --query)")
    .option("--folder <folder>", "Folder")
    .option("--winsorize <pct>", "Winsorize percentile (1-99)", "99")
    .option("--mde <value>", "Min detectable effect (0-1)")
    .action(
      async (
        name: string,
        opts: {
          event: string;
          query?: string;
          queryIr?: string;
          folder?: string;
          winsorize: string;
          mde?: string;
        },
      ) => {
        if (!opts.query && !opts.queryIr) {
          console.error("Provide --query or --query-ir. Run `shipeasy metrics grammar` for syntax.");
          process.exit(1);
        }
        if (opts.query) {
          try {
            const ir = parse(opts.query);
            if (ir.metric !== opts.event) {
              console.error(
                `Query metric '${ir.metric}' must equal --event '${opts.event}' (they reference the same event).`,
              );
              process.exit(1);
            }
          } catch (e) {
            console.error(`Invalid query: ${e instanceof Error ? e.message : String(e)}`);
            console.error("Run `shipeasy metrics grammar` for the supported syntax.");
            process.exit(1);
          }
        }
        try {
          const api = getApiClient(undefined, { requireBinding: true });
          const body: Record<string, unknown> = {
            name,
            event_name: opts.event,
            folder: opts.folder ?? null,
            winsorize_pct: Number(opts.winsorize),
            min_detectable_effect: opts.mde !== undefined ? Number(opts.mde) : null,
          };
          if (opts.query) body.query = opts.query;
          if (opts.queryIr) body.query_ir = JSON.parse(opts.queryIr);
          const res = await api.request<{ id: string; name: string }>(
            "POST",
            "/api/admin/metrics",
            body,
          );
          console.log(`Created metric ${res.name} (${res.id})`);
        } catch (e) {
          handleError(e);
        }
      },
    );

  withExamples(createCmd, [
    {
      note: "Unique users who completed checkout",
      run: "shipeasy metrics create checkouts --event checkout_completed \\\n  --query 'count_users(checkout_completed)'",
    },
    {
      note: "p99 latency by route, grouped",
      run: "shipeasy metrics create api-latency --event req_dur \\\n  --query 'p99(req_dur{route=~\"/api/.*\"}, ms) by (route)'",
    },
  ]);

  const deleteCmd = cmd
    .command("delete <id>")
    .description("Delete a metric (soft delete)")
    .action(async (id: string) => {
      try {
        const api = getApiClient(undefined, { requireBinding: true });
        await api.request("DELETE", `/api/admin/metrics/${id}`);
        console.log(`Deleted metric ${id}`);
      } catch (e) {
        handleError(e);
      }
    });

  withExamples(deleteCmd, [{ run: "shipeasy metrics delete 3f9a2c1b" }]);
}

function handleError(e: unknown): void {
  if (e instanceof ApiError) {
    console.error(`Error (${e.status}): ${e.message}`);
  } else {
    console.error(String(e));
  }
  process.exit(1);
}

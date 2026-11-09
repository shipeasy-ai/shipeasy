/**
 * True when the argv after the subcommand asks for help. Checked BEFORE a
 * subcommand runs, so `shipeasy-mcp install --help` prints usage instead of
 * starting a browser sign-in that the user never asked for.
 */
export function wantsHelp(args: readonly string[]): boolean {
  return args.some((a) => a === "--help" || a === "-h");
}

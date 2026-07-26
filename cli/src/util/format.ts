/**
 * Terminal formatting for the CLI's human-facing output: a small ANSI palette, an
 * inline-markdown renderer, and a width-aware paragraph wrapper.
 *
 * Not chalk — chalk 5 is ESM-only and this package builds to CJS.
 *
 * **Everything here is the identity function when the stream isn't a
 * colour-capable TTY** (a pipe, CI, a coding agent reading stdout, the test
 * runner). Markdown source is already the readable plain-text form, so a
 * non-terminal reader gets the text verbatim rather than escape codes it won't
 * render — or markers stripped out of text it may want to parse.
 */

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

/** `null` → auto-detect. Set by tests (and `--no-color`) to force a mode. */
let override: boolean | null = null;

export function setColorEnabled(on: boolean | null): void {
  override = on;
}

/**
 * Whether to emit ANSI. Honours the `NO_COLOR` / `FORCE_COLOR` conventions
 * before falling back to "is stdout a terminal".
 */
export function colorEnabled(): boolean {
  if (override !== null) return override;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  if (process.env.TERM === "dumb") return false;
  return Boolean(process.stdout.isTTY);
}

function sgr(open: string): (s: string) => string {
  return (s: string) => (colorEnabled() ? `${ESC}${open}${s}${RESET}` : s);
}

export const bold = sgr("1m");
export const dim = sgr("2m");
export const italic = sgr("3m");
export const underline = sgr("4m");
export const red = sgr("31m");
export const green = sgr("32m");
export const yellow = sgr("33m");
export const cyan = sgr("36m");
export const gray = sgr("90m");
export const magenta = sgr("35m");

// ── inline markdown ─────────────────────────────────────────────────────────

/** `**bold**`, `` `code` ``, `[label](url)`, and bare URLs — the subset our copy
 *  actually uses. Matched in one pass so a code span can't be re-scanned as bold. */
const INLINE = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()"'`]+)/g;

/**
 * Render inline markdown to ANSI: bold stays bold, `code` becomes cyan (markers
 * dropped — the colour is the delimiter), links become their label plus a dim
 * URL, bare URLs get underlined so they stay click-targets in terminals that
 * detect them.
 *
 * With colour off, only the `**` markers come off — nothing else is rewritten.
 * Bold has no plain-text equivalent, so its markers are pure noise in a pipe;
 * backticks are the CLI's long-standing convention for "this is a command",
 * carry meaning to a coding agent parsing the output, and stay.
 */
export function md(text: string): string {
  if (!colorEnabled()) return text.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  return text.replace(INLINE, (m) => {
    if (m.startsWith("**")) return bold(m.slice(2, -2));
    if (m.startsWith("`")) return cyan(m.slice(1, -1));
    if (m.startsWith("[")) {
      const [, label, url] = /^\[([^\]]+)\]\((.+)\)$/.exec(m) ?? [];
      return label && url ? `${bold(label)} ${dim(url)}` : m;
    }
    return underline(m);
  });
}

/** Visible width of a token once {@link md} has dropped its markers. */
function visibleLength(token: string): number {
  return token
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 $2").length;
}

/**
 * Split a paragraph into wrappable tokens, keeping a multi-word markdown span
 * (`**like this**`, `` `a command --with flags` ``) as ONE token.
 *
 * This is load-bearing, not tidiness: {@link INLINE} can't match across a
 * newline, so a span the wrapper broke in half would lose its styling AND leave
 * its raw `**` markers on screen.
 */
function tokenize(paragraph: string): string[] {
  const SPAN = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\((?:https?:\/\/[^)\s]+)\)/g;
  const out: string[] = [];
  let last = 0;
  for (const m of paragraph.matchAll(SPAN)) {
    const before = paragraph.slice(last, m.index);
    const words = before.split(/\s+/).filter(Boolean);
    // Punctuation glued to EITHER side of a span travels with it, so "(`?se=1`)"
    // wraps as one token instead of leaving a stranded "(" at the line end.
    const leading = before === "" || /\s$/.test(before) ? "" : (words.pop() ?? "");
    out.push(...words);
    const trailing = /^\S*/.exec(paragraph.slice(m.index + m[0].length))![0];
    out.push(leading + m[0] + trailing);
    last = m.index + m[0].length + trailing.length;
  }
  out.push(...paragraph.slice(last).split(/\s+/).filter(Boolean));
  return out;
}

// ── status glyphs ───────────────────────────────────────────────────────────

const GLYPH: Record<string, (s: string) => string> = {
  "✓": green,
  "✗": red,
  "⚠": yellow,
  "•": gray,
  "·": gray,
  "→": cyan,
  "▸": cyan,
  "▶": magenta,
};

/**
 * Colour the leading status glyph of every line — the thing the eye scans a
 * setup log for. Only the glyph is coloured, never the message, so a wall of
 * output still reads as one colour with green/red punctuation down the margin.
 */
export function paintGlyphs(text: string): string {
  if (!colorEnabled()) return text;
  return text
    .split("\n")
    .map((line) =>
      line.replace(
        /^(\s*)([✓✗⚠•·→▸▶])(\s|$)/u,
        (_m, indent: string, g: string, tail: string) => `${indent}${GLYPH[g]!(g)}${tail}`,
      ),
    )
    .join("\n");
}

/** The one call sites use: inline markdown + glyph colouring, in that order. */
export function format(text: string): string {
  return paintGlyphs(md(text));
}

// ── wrapping ────────────────────────────────────────────────────────────────

/** Wrap column: the terminal's, clamped to a comfortable measure for prose. */
export function termWidth(): number {
  return Math.max(48, Math.min(process.stdout.columns || 80, 96));
}

export interface WrapOpts {
  /** Prefix for every line (default two spaces — the setup log's body indent). */
  indent?: string;
  /** Prefix for the FIRST line, when it differs (bullets, "→ " leaders). */
  first?: string;
  width?: number;
}

/**
 * Word-wrap `text` to the terminal width, keeping markdown spans (`` `code` ``,
 * `**bold**`, `[label](url)`) unbroken so {@link md} can still match them, and
 * measuring against their rendered width rather than their source length.
 *
 * Blank lines are preserved as paragraph breaks; single newlines are treated as
 * soft and re-flowed, so copy can be authored as one string per paragraph.
 */
export function wrapText(text: string, opts: WrapOpts = {}): string {
  const indent = opts.indent ?? "  ";
  const first = opts.first ?? indent;
  const width = opts.width ?? termWidth();

  return text
    .split(/\n\s*\n/)
    .map((para, pi) => {
      const words = tokenize(para.trim());
      const lines: string[] = [];
      let line = "";
      let lineWidth = 0;
      for (const w of words) {
        const lead = pi === 0 && lines.length === 0 ? first : indent;
        const wLen = visibleLength(w);
        if (line && lead.length + lineWidth + 1 + wLen > width) {
          lines.push(line);
          line = "";
          lineWidth = 0;
        }
        line = line ? `${line} ${w}` : w;
        lineWidth += (lineWidth ? 1 : 0) + wLen;
      }
      if (line) lines.push(line);
      return lines
        .map((l, i) => `${pi === 0 && i === 0 ? first : indent}${l}`)
        .join("\n");
    })
    .join("\n\n");
}

/** A wrapped bullet with a hanging indent, so continuation lines line up under
 *  the text and not under the glyph. */
export function bullet(text: string, opts: { indent?: string; glyph?: string } = {}): string {
  const indent = opts.indent ?? "    ";
  const glyph = opts.glyph ?? "•";
  return wrapText(text, { first: `${indent}${glyph} `, indent: `${indent}${" ".repeat(glyph.length + 1)}` });
}

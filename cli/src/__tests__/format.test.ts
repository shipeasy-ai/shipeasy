import { afterEach, describe, expect, it } from "vitest";
import {
  bullet,
  colorEnabled,
  format,
  md,
  paintGlyphs,
  setColorEnabled,
  wrapText,
} from "../util/format";

afterEach(() => setColorEnabled(null));

const strip = (s: string): string => s.replace(/\x1b\[\d+m/g, "");

describe("colour detection", () => {
  it("honours NO_COLOR / FORCE_COLOR over the TTY check", () => {
    setColorEnabled(null);
    const prev = { no: process.env.NO_COLOR, force: process.env.FORCE_COLOR };
    try {
      process.env.NO_COLOR = "1";
      delete process.env.FORCE_COLOR;
      expect(colorEnabled()).toBe(false);
      delete process.env.NO_COLOR;
      process.env.FORCE_COLOR = "1";
      expect(colorEnabled()).toBe(true);
    } finally {
      if (prev.no === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prev.no;
      if (prev.force === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prev.force;
    }
  });
});

describe("md — inline markdown", () => {
  it("renders bold, code, links and bare URLs when colour is on", () => {
    setColorEnabled(true);
    expect(md("**hi**")).toBe("\x1b[1mhi\x1b[0m");
    // Code spans lose their backticks — the colour IS the delimiter.
    expect(md("run `shipeasy login`")).toBe("run \x1b[36mshipeasy login\x1b[0m");
    expect(strip(md("[Docs](https://docs.shipeasy.ai)"))).toBe("Docs https://docs.shipeasy.ai");
    expect(md("see https://x.dev")).toContain("\x1b[4mhttps://x.dev\x1b[0m");
  });

  it("strips only the bold markers with colour off, leaving everything else byte-identical", () => {
    setColorEnabled(false);
    expect(md("**What it is:** run `shipeasy login` — https://x.dev")).toBe(
      "What it is: run `shipeasy login` — https://x.dev",
    );
  });

  it("never emits escape codes with colour off", () => {
    setColorEnabled(false);
    const src = "**a** `b` [c](https://d.dev) https://e.dev";
    expect(md(src)).not.toContain("\x1b");
  });
});

describe("paintGlyphs", () => {
  it("colours the leading status glyph and nothing else", () => {
    setColorEnabled(true);
    const out = paintGlyphs("  ✓ server key minted");
    expect(out).toBe("  \x1b[32m✓\x1b[0m server key minted");
  });

  it("leaves a glyph that isn't the first thing on the line alone", () => {
    setColorEnabled(true);
    expect(paintGlyphs("  fix the ✗ lines")).toBe("  fix the ✗ lines");
  });

  it("is the identity function with colour off", () => {
    setColorEnabled(false);
    expect(format("  ✗ install failed")).toBe("  ✗ install failed");
  });
});

describe("wrapText", () => {
  it("re-flows soft newlines to the requested width, with the indent", () => {
    setColorEnabled(false);
    const out = wrapText("one two three four five six", { width: 16, indent: "  " });
    expect(out.split("\n")).toEqual(["  one two three", "  four five six"]);
  });

  it("keeps a multi-word markdown span on one line", () => {
    // Load-bearing: the inline regexes can't match across a newline, so a span
    // split by the wrapper would lose its styling AND show its raw markers.
    setColorEnabled(false);
    const out = wrapText("aaa **bold phrase here** bbb", { width: 20, indent: "" });
    expect(out).toContain("**bold phrase here**");
    // No line may carry a dangling marker — every `**` on it must be paired.
    for (const line of out.split("\n")) expect((line.match(/\*\*/g) ?? []).length % 2).toBe(0);
  });

  it("measures a span by its rendered width, not its source length", () => {
    setColorEnabled(false);
    // "`abcdefgh`" is 10 source chars but renders as 8 — it fits in a width of 8.
    expect(wrapText("`abcdefgh`", { width: 8, indent: "" })).toBe("`abcdefgh`");
  });

  it("keeps blank-line paragraph breaks", () => {
    setColorEnabled(false);
    expect(wrapText("a\n\nb", { width: 40, indent: "" })).toBe("a\n\nb");
  });

  it("honours a distinct first-line prefix, hanging the rest", () => {
    setColorEnabled(false);
    const out = wrapText("one two three", { width: 12, first: "  ⚠ ", indent: "    " });
    expect(out.split("\n")[0]).toBe("  ⚠ one two");
    expect(out.split("\n")[1]).toBe("    three");
  });
});

describe("bullet", () => {
  it("hangs continuation lines under the text, not the glyph", () => {
    setColorEnabled(false);
    const lines = bullet("alpha beta gamma delta", { indent: "  " }).split("\n");
    expect(lines[0]!.startsWith("  • ")).toBe(true);
    for (const l of lines.slice(1)) expect(l.startsWith("    ")).toBe(true);
  });
});

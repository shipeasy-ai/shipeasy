import { defineConfig } from "tsup";

// Three published entries mirror the `exports` map: the root barrel, the
// generated client (`./client`), and the generated zod (`./schemas`). The
// generated fetch client is bundled, so `zod` is the only runtime dependency.
export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/schemas.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: ["zod"],
});

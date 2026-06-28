import { defineConfig } from "tsup";

// Three published entries mirror the `exports` map: the root barrel, the
// generated client (`./client`), and the generated zod (`./schemas`). The
// generated fetch client is bundled, so `zod` is the only runtime dependency.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    schemas: "src/schemas.ts",
    custom: "src/custom/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: ["zod"],
});

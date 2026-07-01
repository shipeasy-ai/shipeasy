import { defineConfig } from "tsup";

// Published entries mirror the `exports` map: the root barrel, the generated
// client (`./client`), the generated zod (`./schemas`), the worker-safe custom
// op registry (`./custom`), and the node-only fs helpers (`./node-context`, kept
// separate so `node:fs` never lands in the worker graph). The generated fetch
// client is bundled, so `zod` is the only runtime dependency.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    schemas: "src/schemas.ts",
    custom: "src/custom/index.ts",
    "node-context": "src/node-context/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: ["zod"],
});

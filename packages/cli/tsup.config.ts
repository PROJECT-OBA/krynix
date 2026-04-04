import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

export default defineConfig([
  // Library entry (dual ESM + CJS)
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: { compilerOptions: { composite: false } },
    clean: true,
    sourcemap: true,
  },
  // Binary entry (ESM only, with shebang)
  {
    entry: ["src/main.ts"],
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    define: {
      __CLI_VERSION__: JSON.stringify(pkg.version),
    },
  },
  // Standalone binary (single file, all deps bundled — zero node_modules needed)
  {
    entry: ["src/main.ts"],
    format: ["cjs"],
    outDir: "dist/standalone",
    outExtension: () => ({ js: ".cjs" }),
    banner: { js: "#!/usr/bin/env node" },
    noExternal: [/@krynix\/.*/, "yaml", "ajv", "ajv-formats"],
    splitting: false,
    platform: "node",
    sourcemap: false,
    minify: true,
    define: {
      __CLI_VERSION__: JSON.stringify(pkg.version),
    },
  },
]);

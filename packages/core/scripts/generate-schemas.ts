/**
 * Generates standalone JSON Schema files from the inlined schemas in schema-validator.ts.
 *
 * Usage: npx tsx scripts/generate-schemas.ts
 *
 * Output: schemas/trace.schema.json, schemas/policy.schema.json, schemas/report.schema.json
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { traceEventSchema, policySchema, reportSchema } from "../src/schema-validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "schemas");

mkdirSync(outDir, { recursive: true });

const schemas = [
  { name: "trace.schema.json", schema: traceEventSchema },
  { name: "policy.schema.json", schema: policySchema },
  { name: "report.schema.json", schema: reportSchema },
];

for (const { name, schema } of schemas) {
  const path = join(outDir, name);
  writeFileSync(path, JSON.stringify(schema, null, 2) + "\n");
  console.log(`Written: ${path}`);
}

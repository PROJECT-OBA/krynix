/**
 * Verify the realistic golden trace passes all Krynix validation checks.
 */
import { readTrace, validateTraceEvent, validateHashChain } from "../packages/core/src/index.js";
import { verifyTrace } from "../packages/replay/src/index.js";

const TRACE_PATH = "test/golden/realistic-coding-session.trace.jsonl";

// 1. Full replay verification
const replayResult = await verifyTrace(TRACE_PATH);
console.log("Replay verify:", replayResult.status);
if (replayResult.validationErrors?.length) {
  console.error("  Errors:", replayResult.validationErrors);
}

// 2. Per-event schema validation
const events = await readTrace(TRACE_PATH);
console.log("Events loaded:", events.length);

let schemaErrors = 0;
for (const event of events) {
  const result = validateTraceEvent(event);
  if (result.valid === false) {
    console.error("  SCHEMA FAIL event", event.sequence_num, event.event_type, ":", result.error);
    schemaErrors++;
  }
}
console.log("Schema validation:", schemaErrors === 0 ? `ALL ${events.length} PASS` : `FAIL (${schemaErrors} errors)`);

// 3. Hash chain
const hashResult = validateHashChain(events);
console.log("Hash chain:", hashResult.valid ? "PASS" : `FAIL at ${hashResult.brokenAt}`);

// 4. Event type breakdown
const typeCounts: Record<string, number> = {};
for (const e of events) typeCounts[e.event_type] = (typeCounts[e.event_type] || 0) + 1;
console.log("Event types:", JSON.stringify(typeCounts));

// 5. Redacted events
const redacted = events.filter(e => e.redacted);
console.log("Redacted events:", redacted.length, redacted.map(e => `seq#${e.sequence_num}`));

// 6. Metadata namespaces used
const nsUsed = new Set<string>();
for (const e of events) {
  if (e.metadata) {
    for (const k of Object.keys(e.metadata)) {
      const ns = k.split(".")[0];
      nsUsed.add(ns);
    }
  }
}
console.log("Metadata namespaces:", [...nsUsed].sort());

// Summary
const allPass = replayResult.status === "pass" && schemaErrors === 0 && hashResult.valid;
console.log("\n=== OVERALL:", allPass ? "ALL CHECKS PASS" : "SOME CHECKS FAILED", "===");
process.exit(allPass ? 0 : 1);

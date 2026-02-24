/**
 * Krynix CLI binary entry point.
 *
 * Thin impure shell: reads process.argv, calls the pure router,
 * writes stdout/stderr, and exits with the appropriate code.
 *
 * @module
 */

import { routeCommand } from "./router.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const result = await routeCommand(argv);

  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout + "\n");
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr + "\n");
  }

  process.exit(result.exitCode);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${String(err)}\n`);
  process.exit(1);
});

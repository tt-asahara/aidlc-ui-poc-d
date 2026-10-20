// D-owned native entry. The framework dispatcher and its routes stay unchanged.
import { main as coreMain, tracedHookRoute } from "../../core/tools/aidlc.ts";
import { hookTrace } from "../../core/tools/aidlc-hook-trace.ts";
import { errorLabel } from "../../core/tools/aidlc-color.ts";
import { runNativeD } from "./native-runtime.ts";

export async function main(argv: string[]): Promise<void> {
  if (argv[0] === "d") await runNativeD(argv.slice(1));
  else await coreMain(argv);
}
if (import.meta.main) {
  const argv = process.argv.slice(2), keepAlive = setInterval(() => {}, 1000);
  void main(argv).catch((error) => {
    const message = (error instanceof Error ? error.message : String(error)).replace(/^aidlc:\s*/, "").trim();
    if (tracedHookRoute(argv)) hookTrace("dispatcher-error", { message });
    const end = argv.indexOf("--"), flags = end < 0 ? argv : argv.slice(0, end);
    if (flags.includes("--json")) console.log(JSON.stringify({ schemaVersion: 1, ok: false, code: 1, status: "failed", message }));
    else if (flags.includes("--quiet")) console.log(message);
    else process.stderr.write(`${errorLabel("aidlc:", process.stderr)} ${message}\n`);
    process.exitCode = 1;
  }).finally(() => clearInterval(keepAlive));
}

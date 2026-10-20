import { basename } from "node:path";
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { D_NATIVE_TOOLS } from "./native-commands.ts";
import { installedDModule } from "./native-runtime.ts";

/** Do not turn an external Bun-based CLI (notably Claude) into a Bun runner. */
export function externalEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result = { ...env }; delete result.BUN_BE_BUN; return result;
}
const nativeMode = () => process.env.BUN_BE_BUN === "1" && !basename(process.execPath).toLowerCase().startsWith("bun");
export function scriptLaunch(tool: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (!nativeMode()) return { argv: [process.execPath, tool, ...args], env };
  const file = basename(tool);
  const internal = ["conductor.ts", "read-only-fanout.ts", "d-feature-checks.ts", "fake-worker.ts"];
  if (!Object.values(D_NATIVE_TOOLS).includes(file) && !internal.includes(file)) throw new Error(`D native script is not registered: ${file}`);
  return { argv: [process.execPath, "--no-env-file", "--no-install", `--config=${installedDModule("native.bunfig.toml")}`, installedDModule(file), ...args], env: { ...env, BUN_BE_BUN: "1" } };
}
/** Embedded D scripts re-enter the compiled core normally, preserving its native trust boundary. */
export function engineLaunch(tool: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (!nativeMode())
    return { argv: [process.execPath, tool, ...args], env };
  const name = basename(tool);
  if (name === "aidlc.ts") return { argv: [process.execPath, ...args], env: externalEnvironment(env) };
  if (Object.values(D_NATIVE_TOOLS).includes(name)) return scriptLaunch(tool, args, env);
  if (name === "aidlc-utility.ts" && args[0] === "intent-create") return { argv: [process.execPath, "engine", "intent", "create", ...args.slice(1)], env: externalEnvironment(env) };
  const routes: Record<string, string> = { "aidlc-orchestrate.ts": "orchestrate", "aidlc-state.ts": "state", "aidlc-log.ts": "log" };
  if (!routes[name]) throw new Error(`D native core tool is not registered: ${name}`);
  return { argv: [process.execPath, "engine", routes[name], ...args], env: externalEnvironment(env) };
}

export function runEngineSync(tool: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  const launch = engineLaunch(tool, args, options.env);
  return spawnSync(launch.argv[0]!, launch.argv.slice(1), { ...options, env: launch.env });
}
export function runScriptSync(tool: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) {
  const launch = scriptLaunch(tool, args, options.env);
  return spawnSync(launch.argv[0]!, launch.argv.slice(1), { ...options, env: launch.env });
}

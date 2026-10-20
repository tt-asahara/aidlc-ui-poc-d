import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { isCompiledExecutable } from "../../core/tools/aidlc-runtime-paths.ts";
import { D_NATIVE_TOOLS } from "./native-commands.ts";

/** Only fixed D module names from the installed runtime; never a project script. */
export function installedDModule(file: string): string {
  const root = isCompiledExecutable()
    ? join(dirname(process.execPath), "runtime", "claude", ".claude", "tools", "d-acceleration")
    : import.meta.dir;
  const script = join(root, file), realRoot = realpathSync(root);
  if (!lstatSync(script).isFile() || !realpathSync(script).startsWith(realRoot + sep)) throw new Error("D tool is outside the installed runtime");
  return script;
}

export async function runNativeD(argv: string[]): Promise<void> {
  const name = argv[0];
  if (!name || name === "--help" || name === "help") {
    console.log(`Usage: aidlc d <tool> [args]\nTools: ${Object.keys(D_NATIVE_TOOLS).join(", ")}`);
    return;
  }
  if (!Object.hasOwn(D_NATIVE_TOOLS, name)) throw new Error(`unknown D tool: ${name}`);
  const file = D_NATIVE_TOOLS[name]!;
  const script = installedDModule(file);
  // Official Bun standalone mode (since 1.2.16), using this same executable.
  // The flag is child-local; no external Bun executable or package install.
  const child = Bun.spawn([process.execPath, "--no-env-file", "--no-install", `--config=${installedDModule("native.bunfig.toml")}`, script, ...argv.slice(1)], {
    env: { ...process.env, BUN_BE_BUN: "1" }, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  process.exitCode = await child.exited;
}

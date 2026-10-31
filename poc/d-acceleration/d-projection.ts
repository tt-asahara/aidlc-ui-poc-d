// Packager-side projection of Arm D's Claude-only acceleration runtime into a
// built `.claude/` tree (called by scripts/package.ts; never shipped itself).
//
// core/ stays byte-identical to upstream AI-DLC, so D adds its own runtime in
// `tools/d-acceleration/` and uniquely named dispatcher adapters in `hooks/`.
// The collision guard compares every
// D destination against the files the core projection actually wrote into the
// tree: the same relative path, or the same basename anywhere in it (a D file
// named like a core file would shadow it for an agent or a resolver). Either
// collision refuses the whole projection before D writes anything.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

export const D_PROJECTION_SUBDIR = join("tools", "d-acceleration");

/** The D runtime files a Claude projection ships, relative to poc/d-acceleration/. */
export const D_ACCELERATION_RUNTIME: readonly string[] = [
  "native-commands.ts",
  "native-runtime.ts",
  "native.bunfig.toml",
  "native-entry.ts",
  "execution.ts",
  "model-routing.md",
  "hooks/aidlc-d-persistence-pre.ts",
  "hooks/aidlc-d-persistence-post.ts",
  "hooks/aidlc-d-reviewer-dispatch-cleanup.ts",
  "hooks/aidlc-d-blocking-sensor-override.ts",
  "aidlc-acceleration-plan.ts",
  "ai-approval-controller.ts",
  "ai-question-answers.ts",
  "ai-question-controller.ts",
  "blocking-sensor-override-hook.ts",
  "conductor.ts",
  "cross-stage-speculation.ts",
  "d-config.ts",
  "d-acceleration.example.jsonc",
  "d-persistence-hook.ts",
  "d-persistence.ts",
  "decision-issue-summary.ts",
  "design-document.ts",
  "design-document-guide.md",
  "document-answers.ts",
  "fake-worker.ts",
  "functional-design-discipline.ts",
  "gh-host.ts",
  "d-feature-checks.ts",
  "grounding.ts",
  "grounding-runtime.ts",
  "generic-auto-cli.ts",
  "host-session.ts",
  "host-session-cli.ts",
  "host-stage-boundary.ts",
  "issue-autopilot.ts",
  "issue-autopilot-runtime.ts",
  "issue-ambiguity-assessor.ts",
  "issue-autopilot-cli.ts",
  "official-acceptance-criteria.ts",
  "official-next-adapter.ts",
  "parallel-guard.ts",
  "person-turn.ts",
  "pr-lens-gate.ts",
  "pr-lens-pin.ts",
  "question-wait.ts",
  "read-only-fanout.ts",
  "requirement-ui-cross-validation.ts",
  "resume-ledger.ts",
  "reviewer-dispatch-cleanup-hook.ts",
  "run.ts",
  "scheduler.ts",
  "stage-policy.json",
  "worker-adapters.ts",
];

/** D-owned hook adapters use the stock dispatcher seam; runtime modules stay separate. */
export function dProjectionPath(file: string): string {
  return file.startsWith("hooks/") ? file : `${D_PROJECTION_SUBDIR.split(sep).join("/")}/${file}`;
}

function* files(dir: string): Generator<string> {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (lstatSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

/** Tree-relative (`/`-separated) paths of every file already in the tree. */
export function projectedPaths(treeRoot: string): string[] {
  return existsSync(treeRoot) ? [...files(treeRoot)].map((path) => relative(treeRoot, path).split(sep).join("/")) : [];
}

/**
 * Every D runtime file that would collide with the projected tree: its
 * destination path already exists there, or its basename equals the basename
 * of a projected file. Empty when the projection is safe.
 */
export function dProjectionCollisions(projected: readonly string[], runtime: readonly string[]): string[] {
  const paths = new Set(projected);
  const names = new Map(projected.map((path) => [basename(path), path]));
  return runtime.flatMap((file) => {
    const destination = dProjectionPath(file);
    if (paths.has(destination)) return [`${destination} (path already projected)`];
    const twin = names.get(basename(file));
    return twin ? [`${destination} (same name as projected ${twin})`] : [];
  });
}

// D modules that import the engine read-only reach it through ../../core in
// the source checkout and through the sibling ../ in a projected tree.
function projectCoreImports(text: string): string {
  return text
    .replaceAll('from "../../core/tools/aidlc-directive.ts"', 'from "../aidlc-directive.ts"')
    .replaceAll('from "../../core/tools/aidlc-runtime-paths.ts"', 'from "../aidlc-runtime-paths.ts"')
    .replaceAll('from "../../core/tools/aidlc.ts"', 'from "../aidlc.ts"')
    .replaceAll('from "../../core/tools/aidlc-hook-trace.ts"', 'from "../aidlc-hook-trace.ts"')
    .replaceAll('from "../../core/tools/aidlc-color.ts"', 'from "../aidlc-color.ts"')
    .replaceAll('from "../../core/tools/aidlc-message-store.ts"', 'from "../aidlc-message-store.ts"')
    .replaceAll('from "../../core/tools/aidlc-lib.ts"', 'from "../aidlc-lib.ts"');
}

/** Copy the D runtime into `<treeRoot>/tools/d-acceleration/`, refusing any collision first. */
export function projectDAcceleration(treeRoot: string, accelerationRoot: string, runtime: readonly string[] = D_ACCELERATION_RUNTIME): void {
  for (const file of runtime) {
    const source = join(accelerationRoot, file);
    if (!existsSync(source) || !lstatSync(source).isFile()) throw new Error(`[claude] D acceleration runtime source is missing: ${file}`);
  }
  const collisions = dProjectionCollisions(projectedPaths(treeRoot), runtime);
  if (collisions.length) throw new Error(`[claude] D acceleration runtime would overwrite or shadow a projected core file: ${collisions.join(", ")}`);
  for (const file of runtime) {
    const source = join(accelerationRoot, file);
    const destination = join(treeRoot, dProjectionPath(file));
    mkdirSync(dirname(destination), { recursive: true });
    if (file.endsWith(".ts")) {
      const text = readFileSync(source, "utf8");
      writeFileSync(destination, file.startsWith("hooks/")
        ? text.replace(/from "\.\.\/([a-z0-9-]+\.ts)"/g, 'from "../tools/d-acceleration/$1"')
        : projectCoreImports(text));
    }
    else cpSync(source, destination);
  }
}

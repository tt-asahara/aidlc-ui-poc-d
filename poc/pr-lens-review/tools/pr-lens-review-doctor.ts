// /aidlc --doctor checks for the optional pr-lens-review plugin. Read-only and
// dependency-free: it asks D's gate (the one owner of features.prLensReview and
// of the pinned-install check) without recording anything. OFF is a passing
// advisory row; ON without the pinned install or the composed fragment fails.
import { existsSync } from "node:fs";
import { join } from "node:path";

const projectDir = process.env.AIDLC_PROJECT_DIR ?? process.cwd();
const harnessDir = process.env.AIDLC_HARNESS_DIR ?? ".claude";
const gateModule = join(projectDir, harnessDir, "tools", "d-acceleration", "pr-lens-gate.ts");
type Check = { pass: boolean; label: string; fix: string; severity: "error" | "advisory" };
const checks: Check[] = [];
if (!existsSync(gateModule)) {
  checks.push({ pass: false, label: "pr-lens-review: installed D runtime (pr-lens-gate.ts)", fix: "Install D first (poc/d-acceleration/fresh-install.ts), then run the D pr-lens setup.", severity: "error" });
} else {
  try {
    const { prLensGate } = await import(gateModule) as { prLensGate: (dir: string) => { status: string; reason?: string; detail?: string; next?: string } };
    const gate = prLensGate(projectDir);
    if (gate.status === "skipped-by-config") checks.push({ pass: true, label: "pr-lens-review: features.prLensReview is OFF (default); Build and Test skips PR Lens", fix: "Set features.prLensReview=true in .claude/d-acceleration.local.jsonc to opt in.", severity: "advisory" });
    else checks.push({ pass: gate.status === "ready", label: `pr-lens-review: features.prLensReview is ON; pinned PR Lens ${gate.status === "ready" ? "ready" : `not ready (${gate.reason}: ${gate.detail})`}`, fix: gate.next ?? "Run the D pr-lens setup.", severity: "error" });
  } catch (error) {
    checks.push({ pass: false, label: `pr-lens-review: D configuration invalid (${(error as Error).message})`, fix: "Fix .claude/d-acceleration(.local).jsonc.", severity: "error" });
  }
}
process.stdout.write(`${JSON.stringify({ checks })}\n`);

// Keeps aidlc/spaces/<space>/dashboard.html current: registered on
// SessionStart and Stop, so the page is fresh when a session opens and after
// every turn. Advisory: it writes one generated file and nothing else, prints
// nothing, and exits 0 on every path, so a dashboard that cannot render never
// stops a session or a turn.
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { writeDashboard } from "./dashboard.ts";

export function run(text: string): number {
  let input: { cwd?: string } = {};
  try { input = JSON.parse(text || "{}"); } catch { input = {}; }
  const explicit = process.env.AIDLC_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR;
  const projectDir = explicit ? (isAbsolute(explicit) ? explicit : resolve(process.cwd(), explicit)) : input.cwd;
  if (!projectDir || !existsSync(join(projectDir, "aidlc"))) return 0;
  try { writeDashboard(projectDir); } catch { /* advisory: never block a session or a turn */ }
  return 0;
}

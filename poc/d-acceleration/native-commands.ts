/** D owns this namespace; it deliberately stays outside the trusted engine prefix. */
export const D_NATIVE_TOOLS: Readonly<Record<string, string>> = Object.fromEntries([
  "generic-auto-cli", "run", "host-stage-boundary", "ai-question-controller",
  "ai-question-answers", "ai-approval-controller", "host-session-cli", "parallel-guard",
  "design-document", "pr-lens-gate", "issue-autopilot-cli", "decision-issue-summary",
].map((name) => [name, `${name}.ts`]));
export const D_PROMPTED_TOOLS = new Set(["issue-autopilot-cli", "decision-issue-summary"]);

export function nativeDInvocations(text: string, harnessDir: string): string {
  // Authored Claude settings/docs retain .claude even when the manifest's
  // projected harnessDir is renamed. Both spellings name the same fixed tools.
  const escaped = [...new Set([harnessDir, ".claude"])].map(dir => dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`\\bbun\\s+(?:${escaped})/tools/d-acceleration/([a-z0-9-]+)\\.ts\\b`, "g"), (whole, name: string) =>
    Object.hasOwn(D_NATIVE_TOOLS, name) ? `aidlc d ${name}` : whole);
}
export function nativeDAllow(rule: unknown): string | null {
  if (typeof rule !== "string") return null;
  const name = /^Bash\(aidlc d ([a-z0-9-]+) \*\)$/.exec(rule)?.[1];
  return name && Object.hasOwn(D_NATIVE_TOOLS, name) && !D_PROMPTED_TOOLS.has(name) ? rule : null;
}
export function invalidNativeDInvocations(text: string): string[] {
  return [...text.matchAll(/\baidlc\s+d\s+([a-z0-9-]+)/g)]
    .map((match) => match[1]).filter((name) => !Object.hasOwn(D_NATIVE_TOOLS, name) && !["--help", "help"].includes(name));
}

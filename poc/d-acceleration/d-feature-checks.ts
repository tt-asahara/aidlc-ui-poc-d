#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { resolveDConfig } from "./d-config.ts";
import { runRequirementUiCrossValidation } from "./requirement-ui-cross-validation.ts";
import { runFunctionalDesignDiscipline } from "./functional-design-discipline.ts";
import { runGrounding, type GroundingStage } from "./grounding.ts";
import { createClaudeGroundingWorker, persistGroundingEvidence } from "./grounding-runtime.ts";

type Manifest = { stage: string; unit?: string; traceabilityPath?: string; uiContractPath?: string; artifactPaths?: string[]; functionalArtifacts?: Record<string, string>; groundingOutputPath?: string; workerExecutable?: string };
const args = process.argv.slice(2), get = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
const projectDir = get("--project-dir"), inputPath = get("--input");
if (!projectDir || !isAbsolute(projectDir) || !inputPath) throw new Error("--project-dir absolute path and --input are required");
const root = realpathSync(projectDir);
function bounded(path: string, mustExist = true): string {
  const candidate = isAbsolute(path) ? path : resolve(root, path);
  const canonical = mustExist ? realpathSync(candidate) : resolve(realpathSync(dirname(candidate)), candidate.split(/[\\/]/).at(-1)!);
  const rel = relative(root, canonical);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`D feature path escapes project: ${path}`);
  if (mustExist && !existsSync(canonical)) throw new Error(`D feature path does not exist: ${path}`);
  return canonical;
}
const manifest = JSON.parse(readFileSync(bounded(inputPath), "utf8")) as Manifest;
const config = resolveDConfig(projectDir), readJson = (path: string) => JSON.parse(readFileSync(bounded(path), "utf8"));
const results: Record<string, unknown> = {}, notReady: string[] = [];
const applicableEnabled =
  (config.features.requirementIdValidation && ["ui-ux-design", "functional-design"].includes(manifest.stage)) ||
  (config.features.functionalDesignDocumentDiscipline && manifest.stage === "functional-design") ||
  (config.features.sourceGrounding && manifest.stage === "domain-design") ||
  (config.features.specGrounding && ["domain-design", "functional-design", "code-generation"].includes(manifest.stage));
if (!applicableEnabled) { process.stdout.write(`${JSON.stringify({ status: "disabled-or-not-applicable", stage: manifest.stage, reads: 0, workerCalls: 0, artifactsWritten: 0 })}\n`); process.exit(0); }

if (config.features.requirementIdValidation && ["ui-ux-design", "functional-design"].includes(manifest.stage)) {
  if (!manifest.traceabilityPath || !manifest.uiContractPath) throw new Error("enabled requirement ID validation requires traceabilityPath and uiContractPath");
  const result = runRequirementUiCrossValidation(true, () => ({ traceability: readJson(manifest.traceabilityPath!), contract: readJson(manifest.uiContractPath!), bridges: config.featureInputs.requirementIdBridges }));
  results.requirementIdValidation = result; if (!result.pass) notReady.push("requirementIdValidation");
}
if (config.features.functionalDesignDocumentDiscipline && manifest.stage === "functional-design") {
  if (!manifest.functionalArtifacts || !manifest.traceabilityPath) throw new Error("enabled functional design discipline requires functionalArtifacts and traceabilityPath");
  const result = runFunctionalDesignDiscipline(true, () => ({ stage: manifest.stage, artifacts: Object.fromEntries(Object.entries(manifest.functionalArtifacts!).map(([name, path]) => [name, readFileSync(bounded(path), "utf8")])), traceability: readJson(manifest.traceabilityPath!), budgets: config.featureInputs.functionalDesignBudgets }));
  results.functionalDesignDocumentDiscipline = result; if (!result.pass) notReady.push("functionalDesignDocumentDiscipline");
}
for (const lane of ["source", "spec"] as const) {
  const enabled = lane === "source" ? config.features.sourceGrounding : config.features.specGrounding;
  if (!enabled) continue;
  const roots = lane === "source" ? config.featureInputs.sourceRoots : config.featureInputs.specRoots;
  const result = await runGrounding({ lane, stage: manifest.stage as GroundingStage, projectDir, artifactPaths: manifest.artifactPaths ?? [], config: { [`${lane}Grounding`]: { enabled: true, roots } }, worker: createClaudeGroundingWorker({ cwd: projectDir, executable: manifest.workerExecutable }) });
  results[`${lane}Grounding`] = result;
  if (result.action === "grounding-findings" && (result.verdict === "NOT-READY" || result.uncertainty.length)) notReady.push(`${lane}Grounding`);
}
const evidence = { schema: 1, stage: manifest.stage, unit: manifest.unit ?? null, verdict: notReady.length ? "NOT-READY" : "READY", notReady, results, approvalRecorded: false, reviewPresentation: "Pass this evidence path to the existing official reviewer; it is not a review receipt or approval." };
const requestedOutput = manifest.groundingOutputPath ?? join("aidlc", ".aidlc-engine", "d-evidence", `${manifest.stage}${manifest.unit ? `-${manifest.unit}` : ""}.json`);
const outputParent = dirname(resolve(root, requestedOutput));
// The default parent may not exist yet; create only after its nearest existing
// ancestor has been proven inside the project.
let ancestor = outputParent; while (!existsSync(ancestor)) ancestor = dirname(ancestor);
const ancestorRel = relative(root, realpathSync(ancestor)); if (ancestorRel.startsWith("..") || isAbsolute(ancestorRel)) throw new Error(`D feature output escapes project: ${requestedOutput}`);
const outputPath = resolve(root, requestedOutput); if (relative(root, outputPath).startsWith("..") || isAbsolute(relative(root, outputPath))) throw new Error(`D feature output escapes project: ${requestedOutput}`);
persistGroundingEvidence(outputPath, evidence);
process.stdout.write(`${JSON.stringify({ ...evidence, evidencePath: outputPath }, null, 2)}\n`);
process.exit(notReady.length ? 2 : 0);

export type ClaudeLaunch = { executable: string; args: string[]; requestedModel: string; requestedEffort: string };

export function claudeLaunch(model: string, effort: string, prompt: string): ClaudeLaunch {
  if (!model.trim()) throw new Error("a runtime-discovered model ID is required");
  if (!["low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error("unsupported Claude effort");
  return { executable: "claude", args: ["--print", "--output-format", "json", "--permission-prompts", "none", "--model", model, "--effort", effort, prompt], requestedModel: model, requestedEffort: effort };
}

// This adapter intentionally only constructs an argv array. Authentication and
// model availability must be established by the user's normal Claude terminal;
// managed execution must not retry login or substitute an API credential.

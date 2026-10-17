#!/usr/bin/env bun
/**
 * Local stand-in for the GitHub CLI used by the external-integration sandbox.
 *
 * It never contacts a network. State lives in the JSON file named by
 * FAKE_GH_STATE; every invocation's exact argv (plus GH_HOST) is appended as
 * one JSON line to FAKE_GH_LOG (a fixed-argv recorder). Only the gh
 * subcommands D actually issues are implemented; anything else exits 2, so an
 * unexpected command is visible instead of silently succeeding.
 *
 * Fault injection: state.faults = [{ match: "issue create", mode, remaining }]
 *   mode "fail"             -> exit 1, no state change
 *   mode "fail-after-write" -> apply the change, then exit 1 (lost response)
 * It can be compiled to a native binary with `bun build --compile` because the
 * decision-summary CLI only accepts a host-pinned native gh executable.
 */
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

type FakeIssue = { number: number; title: string; body: string; labels: string[]; state: "OPEN" | "CLOSED" };
type Fault = { match: string; mode: "fail" | "fail-after-write"; remaining: number };
type State = { loggedIn: string[]; repos: Record<string, { nextNumber: number; issues: FakeIssue[] }>; faults?: Fault[] };

const statePath = process.env.FAKE_GH_STATE;
const logPath = process.env.FAKE_GH_LOG;
const argv = process.argv.slice(2);
if (!statePath) { process.stderr.write("FAKE_GH_STATE is required\n"); process.exit(3); }
if (logPath) appendFileSync(logPath, `${JSON.stringify({ argv, ghHost: process.env.GH_HOST ?? null })}\n`);

const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
const save = () => { const tmp = `${statePath}.${process.pid}.tmp`; writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`); renameSync(tmp, statePath); };
const fail = (code: number, message: string): never => { process.stderr.write(`${message}\n`); process.exit(code); };
const flag = (name: string) => { const at = argv.indexOf(name); return at < 0 ? undefined : argv[at + 1]; };

if (argv[0] === "auth" && argv[1] === "status") {
  const host = flag("--hostname");
  if (!host || argv.length !== 4) fail(2, "fake gh: auth status requires exactly --hostname <host>");
  if (state.loggedIn.includes(host!)) { process.stdout.write(`${host}\n  ✓ Logged in to ${host} account sandbox (fake)\n`); process.exit(0); }
  fail(1, `You are not logged into any accounts on ${host}`);
}

if (argv[0] !== "issue") fail(2, `fake gh: unsupported command ${JSON.stringify(argv)}`);
const repoFlag = flag("--repo");
if (!repoFlag) fail(2, "fake gh: --repo is required in the sandbox");
const parts = repoFlag!.split("/");
const host = (parts.length === 3 ? parts[0] : process.env.GH_HOST ?? "github.com").toLowerCase();
const key = `${host}/${parts.slice(-2).join("/")}`.toLowerCase();
if (!state.loggedIn.includes(host)) fail(4, `To get started with GitHub CLI, please run:  gh auth login --hostname ${host}`);
const repo = state.repos[key] ?? fail(1, `GraphQL: Could not resolve to a Repository with the name '${key}'.`);

const operation = `${argv[0]} ${argv[1]}`;
const fault = state.faults?.find((entry) => entry.match === operation && entry.remaining > 0);
if (fault) { fault.remaining -= 1; save(); if (fault.mode === "fail") fail(1, `HTTP 502: injected fault for ${operation}`); }
const finish = (stdout: string) => { save(); if (fault?.mode === "fail-after-write") fail(1, `HTTP 502: response lost after ${operation}`); process.stdout.write(stdout); process.exit(0); };

const project = (issue: FakeIssue, fields: string) => Object.fromEntries(fields.split(",").map((field) => [field, field === "labels" ? issue.labels.map((name) => ({ name })) : issue[field as keyof FakeIssue]]));
const byNumber = (value: string | undefined) => repo.issues.find((issue) => issue.number === Number(value)) ?? fail(1, `GraphQL: Could not resolve to an issue or pull request with the number of ${value}.`);

switch (argv[1]) {
  case "view": {
    const issue = byNumber(argv[2]);
    finish(`${JSON.stringify(project(issue, flag("--json") ?? "number,title"))}\n`);
    break;
  }
  case "list": {
    const wanted = flag("--state") ?? "open", search = flag("--search"), limit = Number(flag("--limit") ?? 30);
    const rows = repo.issues
      .filter((issue) => wanted === "all" || issue.state.toLowerCase() === wanted)
      .filter((issue) => !search || issue.body.includes(search) || issue.title.includes(search))
      .slice(0, limit)
      .map((issue) => project(issue, flag("--json") ?? "number,title"));
    finish(`${JSON.stringify(rows)}\n`);
    break;
  }
  case "create": {
    const title = flag("--title"), body = flag("--body");
    if (!title || body === undefined) fail(2, "fake gh: create requires --title and --body");
    const issue: FakeIssue = { number: repo.nextNumber++, title: title!, body: body!, labels: [], state: "OPEN" };
    repo.issues.push(issue);
    finish(`https://${host}/${parts.slice(-2).join("/")}/issues/${issue.number}\n`);
    break;
  }
  case "edit": {
    const issue = byNumber(argv[2]);
    const title = flag("--title"), body = flag("--body");
    if (title !== undefined) issue.title = title;
    if (body !== undefined) issue.body = body;
    finish(`https://${host}/${parts.slice(-2).join("/")}/issues/${issue.number}\n`);
    break;
  }
  default:
    fail(2, `fake gh: unsupported issue subcommand ${argv[1]}`);
}

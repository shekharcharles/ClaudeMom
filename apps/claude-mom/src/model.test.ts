import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { claudeState, emptyProfile, formatWindow, hostOf, normalizeModels, profileProblem, setupSteps, type ClaudeStatus } from "./model.ts";

const status = (patch: Partial<ClaudeStatus> = {}): ClaudeStatus => ({
  supported: true, sourceApp: "", version: "1.0", claudeRunning: false, running: false, connected: false,
  caReady: true, caTrusted: true, nodeAvailable: true, dictationReady: true, models: [], needsRestart: false,
  config: { enabled: true, model: "", localization: true, voiceInput: false, computerUse: false, backgroundMode: false },
  ...patch,
});

test("Provider validation requires a valid Base URL and default model", () => {
  const profile = { ...emptyProfile(), baseUrl: "https://api.example.com", model: "glm-5" };
  assert.equal(profileProblem(profile), null);
  assert.equal(profileProblem({ ...profile, baseUrl: "" }), "Enter a Base URL");
  assert.equal(profileProblem({ ...profile, baseUrl: "api.example.com" }), "Invalid Base URL");
  assert.equal(profileProblem({ ...profile, baseUrl: "ftp://x" }), "Base URL must start with http:// or https://");
  assert.match(profileProblem({ ...profile, baseUrl: "https://x/v1/messages" }) ?? "", /without \/v1\/messages/);
  assert.equal(profileProblem({ ...profile, model: " " }), "Select a default model");
  assert.equal(hostOf("http://127.0.0.1:3425"), "127.0.0.1:3425");
});

test("Deduplicate models with default first", () => {
  assert.deepEqual(normalizeModels(["b", " a ", "b", ""], "a"), ["a", "b"]);
});

test("Status messages for running and stopped Claude", () => {
  assert.deepEqual(claudeState(null, null), { text: "Detecting Claude…", tone: "busy" });
  assert.equal(claudeState(status({ connected: true }), null).tone, "ok");
  assert.equal(claudeState(status({ claudeRunning: true }), null).tone, "warn");
  assert.equal(claudeState(status(), null).text, "Not running");
  assert.equal(claudeState(status(), "launch").text, "Launching…");
  assert.equal(claudeState(status({ supported: false }), null).text, "Claude Desktop not found");
});

test("Setup steps list missing prerequisites in order", () => {
  const ready = { ...emptyProfile(), baseUrl: "https://a.example", model: "m" };
  assert.deepEqual(setupSteps(status(), ready), []);
  assert.deepEqual(setupSteps(status({ caTrusted: false, nodeAvailable: false }), null).map((step) => step.id), ["upstream", "node", "trust"]);
});

test("Context window formatting", () => {
  assert.equal(formatWindow(null), "200k");
  assert.equal(formatWindow(1_000_000), "1M");
  assert.equal(formatWindow(1_100_000), "1.1M");
  assert.equal(formatWindow(400_000), "400k");
});

test("All frontend commands are registered in the backend", () => {
  const app = readFileSync(new URL("./ClaudeMomApp.tsx", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  // Collect command names passed directly to invoke or via bookCall.
  const called = new Set([...app.matchAll(/"(claude_(?:mom|local)_[a-z_]+)"/g)].map((match) => match[1]));
  assert.ok(called.size >= 9, [...called].join(","));
  for (const command of called) assert.ok(new RegExp(`::${command},`).test(lib), `${command} is not registered`);
});

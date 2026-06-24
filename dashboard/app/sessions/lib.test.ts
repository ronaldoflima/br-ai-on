import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanOutput,
  projectName,
  stateRank,
  effectiveView,
  latestActionFor,
  isActiveState,
  matchesQuery,
  whatsHappening,
  type TmuxPane,
  type TmuxAction,
} from "./lib.ts";

function pane(over: Partial<TmuxPane> = {}): TmuxPane {
  return {
    host: "mac", session: "keycloak", window_index: 1, pane_index: 1,
    window_name: null, command: "claude.exe", cwd: "/Users/x/px/projects/px-keycloak",
    state: "claude_idle", state_detail: null, last_output: null, attached: true,
    state_since: "2026-06-12T10:00:00Z", last_seen: "2026-06-12T10:05:00Z",
    ...over,
  };
}

test("cleanOutput remove ANSI, box-drawing e linhas vazias", () => {
  const raw = "\x1b[31mhello\x1b[0m\n────────\n\n\n│  texto real  │\n===\nfim";
  assert.deepEqual(cleanOutput(raw, 10), ["hello", "│ texto real │", "fim"]);
});

test("cleanOutput retorna últimas N linhas com conteúdo", () => {
  const raw = ["a", "b", "c", "d"].join("\n");
  assert.deepEqual(cleanOutput(raw, 2), ["c", "d"]);
});

test("cleanOutput de null/vazio retorna []", () => {
  assert.deepEqual(cleanOutput(null, 5), []);
  assert.deepEqual(cleanOutput("───\n\n", 5), []);
});

test("projectName extrai basename do cwd", () => {
  assert.equal(projectName("/Users/x/px/projects/px-keycloak"), "px-keycloak");
  assert.equal(projectName("/Users/x/px/projects/px-keycloak/"), "px-keycloak");
  assert.equal(projectName(null), null);
});

test("stateRank ordena working < waiting < idle < shell", () => {
  const order = ["claude_working", "claude_waiting_input", "claude_idle", "shell"];
  const ranks = order.map(stateRank);
  assert.deepEqual([...ranks].sort((a, b) => a - b), ranks);
  assert.equal(stateRank("desconhecido"), stateRank("shell"));
});

test("effectiveView: hook mais recente que heurística vence", () => {
  const p = pane({
    state: "claude_idle", state_since: "2026-06-12T10:00:00Z",
    hook_state: "claude_waiting_input", hook_detail: "permissão",
    hook_event_at: "2026-06-12T10:01:00Z",
  });
  const v = effectiveView(p);
  assert.equal(v.state, "claude_waiting_input");
  assert.equal(v.source, "hook");
});

test("effectiveView: heurística mais recente vence o hook", () => {
  const p = pane({
    state: "claude_working", state_since: "2026-06-12T10:02:00Z",
    hook_state: "claude_idle", hook_event_at: "2026-06-12T10:01:00Z",
  });
  assert.equal(effectiveView(p).source, "heurística");
});

test("latestActionFor casa pane por chave e pega a mais recente", () => {
  const actions: TmuxAction[] = [
    { id: 1, host: "mac", session: "keycloak", window_index: 1, pane_index: 1,
      status: "done", result: "ok", action_text: "a", created_at: "2026-06-12T10:00:00Z" },
    { id: 2, host: "mac", session: "keycloak", window_index: 1, pane_index: 1,
      status: "pending", result: null, action_text: "b", created_at: "2026-06-12T10:05:00Z" },
    { id: 3, host: "vps", session: "other", window_index: 1, pane_index: 1,
      status: "error", result: null, action_text: "c", created_at: "2026-06-12T10:06:00Z" },
  ];
  assert.equal(latestActionFor(pane(), actions)?.id, 2);
  assert.equal(latestActionFor(pane({ session: "nada" }), actions), undefined);
});

test("isActiveState: só working e waiting são ativos", () => {
  assert.equal(isActiveState("claude_working"), true);
  assert.equal(isActiveState("claude_waiting_input"), true);
  assert.equal(isActiveState("claude_idle"), false);
  assert.equal(isActiveState("shell"), false);
});

test("matchesQuery: vazio casa tudo; busca em host/session/window_name/projeto", () => {
  const p = pane({ host: "vps-mcpgw", session: "braion", window_name: "logs", cwd: "/home/x/br-ai-on" });
  assert.equal(matchesQuery(p, ""), true);
  assert.equal(matchesQuery(p, "  "), true);
  assert.equal(matchesQuery(p, "BRAION"), true);
  assert.equal(matchesQuery(p, "br-ai-on"), true);
  assert.equal(matchesQuery(p, "logs"), true);
  assert.equal(matchesQuery(p, "nada"), false);
});

test("whatsHappening: prefere detail; cai pra última linha do output; null se nada", () => {
  const withDetail = pane({ state: "claude_working", state_detail: "rodando testes", last_output: "ruído" });
  assert.equal(whatsHappening(withDetail), "rodando testes");
  const noDetail = pane({ state: "shell", state_detail: null, last_output: "linha 1\nlinha final" });
  assert.equal(whatsHappening(noDetail), "linha final");
  const empty = pane({ state: "shell", state_detail: null, last_output: null });
  assert.equal(whatsHappening(empty), null);
});

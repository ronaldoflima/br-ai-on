import { test } from "node:test";
import assert from "node:assert/strict";
import { validateActionBody } from "./validate.ts";

test("aceita body válido e normaliza", () => {
  const r = validateActionBody({
    host: "mac", session: "kc", window_index: 1, pane_index: 0, text: "  oi  ",
  });
  assert.deepEqual(r, {
    ok: true,
    value: { host: "mac", session: "kc", window_index: 1, pane_index: 0, text: "oi" },
  });
});

test("rejeita texto vazio, só espaços ou >2000 chars", () => {
  const base = { host: "m", session: "s", window_index: 0, pane_index: 0 };
  assert.equal(validateActionBody({ ...base, text: "" }).ok, false);
  assert.equal(validateActionBody({ ...base, text: "   " }).ok, false);
  assert.equal(validateActionBody({ ...base, text: "x".repeat(2001) }).ok, false);
});

test("rejeita índices não-inteiros e campos ausentes", () => {
  assert.equal(validateActionBody({ host: "m", session: "s", window_index: 1.5, pane_index: 0, text: "x" }).ok, false);
  assert.equal(validateActionBody({ session: "s", window_index: 1, pane_index: 0, text: "x" }).ok, false);
  assert.equal(validateActionBody(null).ok, false);
});

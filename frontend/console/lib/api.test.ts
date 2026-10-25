import { test } from "node:test";
import assert from "node:assert/strict";
import { api } from "./api.ts";

test("signup reports a readable error when the backend is unreachable", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try {
    await assert.rejects(api.signup("test@example.test", "password123"), (error: any) => {
      assert.equal(error.error.code, "BACKEND_UNAVAILABLE");
      assert.match(error.error.message, /connect/); return true;
    });
  } finally { globalThis.fetch = original; }
});
test("signup preserves the backend's validation message", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { code: "EMAIL_TAKEN", message: "an account with this email already exists" } }, { status: 409 });
  try {
    await assert.rejects(api.signup("test@example.test", "password123"), (error: any) => error.error.code === "EMAIL_TAKEN");
  } finally { globalThis.fetch = original; }
});
test("GET failures cannot be mistaken for successful account data", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    await assert.rejects(api.projects(), (error: any) => error.error.code === "SERVER_ERROR");
  } finally { globalThis.fetch = original; }
});

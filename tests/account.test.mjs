import test from "node:test";
import assert from "node:assert/strict";
import { accountCredentials, accountIdentifier, accountName, accountError, authenticateAccount, canonicalUsername } from "../src/account.ts";

test("username canonicalization is consistent and rejects ambiguous characters", () => {
  assert.equal(canonicalUsername("  Alice_123  "), "alice_123");
  assert.equal(accountIdentifier(" ALICE_123 "), accountIdentifier("alice_123"));
  for (const name of ["ab", "a".repeat(25), "a b", "åke", "Karl", "Ａlice", "_alice", "alice@example.com", "alice.test", "alice+test"]) {
    assert.throws(() => canonicalUsername(name), /Ogiltigt användarnamn/);
  }
});

test("account labels never reveal the internal email or trust mutable metadata", () => {
  assert.equal(accountName({ email: accountIdentifier("Alice"), user_metadata: { username: "someone_else" } }), "alice");
  assert.equal(accountName({ email: "real@example.com" }), "Ditt konto");
});

test("sign up and sign in use the same Supabase identity without trimming passwords", async () => {
  const calls = [];
  const session = { user: { id: "test-user" } };
  const auth = Object.fromEntries(["signUp", "signInWithPassword"].map((method) => [method, async (credentials) => {
    calls.push({ method, ...credentials });
    return { data: { session }, error: null };
  }]));
  assert.equal(await authenticateAccount({ auth }, "signup", " Alice ", " password "), session);
  assert.equal(await authenticateAccount({ auth }, "signin", "ALICE", " password "), session);
  assert.equal(calls[0].email, calls[1].email);
  assert.equal(calls[0].password, " password ");
  assert.deepEqual(calls.map((call) => call.method), ["signUp", "signInWithPassword"]);
});

test("invalid input never reaches Supabase and sign-in accepts existing shorter passwords", async () => {
  let called = false;
  const client = { auth: { signUp: async () => { called = true; } } };
  await assert.rejects(authenticateAccount(client, "signup", "a b", "strong-password"), /Ogiltigt/);
  await assert.rejects(authenticateAccount(client, "signup", "alice", "short"), /minst 8/);
  await assert.rejects(authenticateAccount(client, "signin", "alice", ""), /Ange ditt lösenord/);
  assert.equal(called, false);
  assert.equal(accountCredentials("signin", "alice", "short").password, "short");
});

test("duplicate usernames, invalid credentials and network errors have safe Swedish messages", async () => {
  for (const [code, message] of [["user_already_exists", /upptaget/], ["invalid_credentials", /Fel användarnamn/], ["weak_password", /svagt/]]) {
    const client = { auth: { signUp: async () => ({ data: {}, error: { code, message: "hidden@example.com" } }) } };
    await assert.rejects(authenticateAccount(client, "signup", "alice", "strong-password"), message);
  }
  assert.match(accountError(new TypeError("Failed to fetch")), /anslutningen/);
  assert.match(accountError({ name: "AuthRetryableFetchError" }), /anslutningen/);
  assert.doesNotMatch(accountError({ message: "internal@example.com" }), /@/);
});

test("a signup without a session never reports success or asks for email confirmation", async () => {
  const client = { auth: { signUp: async () => ({ data: { session: null }, error: null }) } };
  await assert.rejects(authenticateAccount(client, "signup", "alice", "strong-password"), /inte redo/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

// Use Vite's real env transformation without reading anyone's .env.local.
async function withClient(url, key, check) {
  const server = await createServer({
    configFile: false,
    envDir: false,
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true },
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(url),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(key),
    },
  });
  let client;
  try {
    const module = await server.ssrLoadModule("/src/supabase.ts");
    const { getSupabaseClient } = module;
    await check(getSupabaseClient, module.usernameSignupReady);
    client = getSupabaseClient();
  } finally {
    await client?.auth.stopAutoRefresh();
    await server.close();
  }
}

test("missing or partial Supabase configuration is optional", async () => {
  for (const [url, key] of [["", ""], ["https://example.supabase.co", ""], ["", "sb_publishable_test"], ["  ", "  "]]) {
    await withClient(url, key, (getClient) => {
      assert.equal(getClient(), null);
      assert.equal(getClient(), null);
    });
  }
});

test("mailbox-free signup requires enabled signup and disabled email confirmation", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [settings, ready] of [
      [{ external: { email: true }, disable_signup: false, mailer_autoconfirm: true }, true],
      [{ external: { email: true }, disable_signup: false, mailer_autoconfirm: false }, false],
      [{ external: { email: true }, disable_signup: true, mailer_autoconfirm: true }, false],
      [{ external: { email: false }, disable_signup: false, mailer_autoconfirm: true }, false],
    ]) {
      globalThis.fetch = async (url, init) => {
        assert.equal(url, "https://example.supabase.co/auth/v1/settings");
        assert.equal(init.headers.apikey, "sb_publishable_test");
        return new Response(JSON.stringify(settings));
      };
      await withClient("https://example.supabase.co", "sb_publishable_test", async (_getClient, checkReady) => {
        assert.equal(await checkReady(), ready);
      });
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("configured Supabase initializes once with a separate auth storage key", async () => {
  await withClient(" https://example.supabase.co ", " sb_publishable_test ", async (getClient) => {
    const client = getClient();
    assert.ok(client);
    assert.equal(getClient(), client);
    assert.equal(client.supabaseUrl, "https://example.supabase.co");
    assert.equal(client.auth.storageKey, "chicappd-supabase-auth");
    const { data, error } = await client.auth.getSession();
    assert.equal(error, null);
    assert.equal(data.session, null);
  });
});

test("malformed configuration returns null without disclosing its values", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    await withClient("not-a-url", "sb_publishable_test", (getClient) => {
      assert.equal(getClient(), null);
      assert.equal(getClient(), null);
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Check VITE_SUPABASE_URL/);
  assert.doesNotMatch(warnings[0], /not-a-url|sb_publishable_test/);
});

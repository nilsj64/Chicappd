// Run with CHICAPPD_TEST_API set to the public Worker URL after deploying it.
import test from "node:test";
import assert from "node:assert/strict";

const base = process.env.CHICAPPD_TEST_API?.replace(/\/$/, "");
if (!base) throw new Error("Set CHICAPPD_TEST_API to the deployed Worker URL.");

async function call(path, { method, token, body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, ...await response.json() };
}

async function waitForLeaveRoute() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await call("/rooms/AAAAA/leave", { method: "POST" });
    if (response.error !== "Okänd begäran.") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail("The deployed Worker still does not route POST /rooms/{code}/leave.");
}

test("deployed Worker accepts the leave request sent by the browser", async () => {
  await waitForLeaveRoute();
  const owner = await call("/rooms", { body: { name: "Leave smoke owner" } });
  assert.equal(owner.status, 201);
  const path = `/rooms/${owner.view.roomCode}`;
  try {
    const guest = await call(`${path}/join`, { body: { name: "Leave smoke guest" } });
    assert.equal(guest.status, 200);
    try {
      assert.equal((await call(`${path}/command`, { token: owner.token, body: { type: "start-round" } })).status, 200);
      const left = await call(`${path}/leave`, { method: "POST", token: guest.token });
      assert.equal(left.status, 200, JSON.stringify(left));
      assert.equal((await call(`${path}/state`, { token: guest.token })).status, 401);
      const remaining = await call(`${path}/state`, { token: owner.token });
      assert.equal(remaining.status, 200);
      assert.equal(remaining.view.phase, "lobby");
      assert.deepEqual(remaining.view.players.map((player) => player.id), [owner.playerId]);
    } finally {
      // If a check fails, still remove the guest when the route supports it.
      await call(`${path}/leave`, { method: "POST", token: guest.token }).catch(() => {});
    }
  } finally {
    await call(`${path}/leave`, { method: "POST", token: owner.token }).catch(() => {});
  }
});

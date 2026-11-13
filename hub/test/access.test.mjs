// Who may talk to the hub: the Host and Origin checks in server.js.
//
// Each hub under test is a copy of ktp-hub/ (without data/ or test/) in a
// temporary folder, run with Bun on a free port, so it never touches the
// real data/ or port 3001. Requests go through node:http so the test can set
// Host and Origin the way a browser would.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const HUB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY = "http://localhost:30000";
const TAILNET = "krypton.tail1234.ts.net";
const EVIL = "https://evil.example";

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function startHub(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ktp-hub-test-"));
  cpSync(HUB_DIR, dir, {
    recursive: true,
    filter: (src) => !["data", "test", "node_modules"].includes(relative(HUB_DIR, src).split(sep)[0]),
  });
  const port = await freePort();
  const childEnv = { ...process.env, PORT: String(port), KENKU_URL: "http://127.0.0.1:9", ...env };
  for (const k of ["ALLOWED_ORIGINS", "ALLOWED_HOSTS"]) if (!(k in env)) delete childEnv[k];
  const child = spawn("bun", ["run", "server.js"], { cwd: dir, env: childEnv });
  let output = "";
  let exited = false;
  const exit = new Promise((resolve) => child.once("exit", () => { exited = true; resolve(); }));
  const stop = async () => {
    if (!exited) child.kill();
    await exit;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`hub didn't start:\n${output}`)), 15000);
      const read = (chunk) => {
        output += chunk;
        if (/Other hosts allowed.*\n/.test(output)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      exit.then(() => { clearTimeout(timer); reject(new Error(`hub exited:\n${output}`)); });
    });
  } catch (e) {
    await stop();
    throw e;
  }
  return {
    port,
    log: () => output,
    // stdout and stderr arrive separately, so a warning may trail the start-up lines.
    async waitForLog(re) {
      for (let i = 0; i < 50 && !re.test(output); i++) await new Promise((r) => setTimeout(r, 20));
      assert.match(output, re);
    },
    stop,
  };
}

// One request to the hub on 127.0.0.1:port with exactly the headers given.
// A 101 (WebSocket accepted) resolves with the status and closes the socket.
function send(port, { method = "GET", path = "/", host, origin, headers = {}, body } = {}) {
  const h = { ...headers };
  if (host !== undefined) h.Host = host;
  if (origin !== undefined) h.Origin = origin;
  if (body !== undefined) h["Content-Length"] = Buffer.byteLength(body);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: h, setHost: false }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve({ status: res.statusCode, headers: res.headers, text: "" });
    });
    req.on("error", reject);
    req.end(body);
  });
}

const post = (port, path, opts = {}) =>
  send(port, { method: "POST", path, headers: { "Content-Type": "application/json" }, body: "{}", ...opts });

const upgrade = (port, opts = {}) =>
  send(port, {
    path: "/ws",
    headers: {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
    },
    ...opts,
  });

// ── The hub with its defaults ──

let hub;
before(async () => { hub = await startHub(); });
after(async () => { await hub?.stop(); });

test("same-origin POST and WebSocket are allowed (localhost and 127.0.0.1)", async () => {
  for (const name of ["localhost", "127.0.0.1"]) {
    const self = { host: `${name}:${hub.port}`, origin: `http://${name}:${hub.port}` };
    assert.equal((await post(hub.port, "/api/scene/hide", self)).status, 200, `POST from ${self.origin}`);
    assert.equal((await upgrade(hub.port, self)).status, 101, `WebSocket from ${self.origin}`);
  }
});

test("a cross-origin POST from another site is refused with 403, and changes nothing", async () => {
  const host = `localhost:${hub.port}`;
  // The attack: a "simple" POST (text/plain, no preflight) to the eval route.
  const evalRes = await post(hub.port, "/api/foundry/eval", {
    host, origin: EVIL, headers: { "Content-Type": "text/plain" }, body: '{"code":"return 1"}',
  });
  assert.equal(evalRes.status, 403);
  assert.match(JSON.parse(evalRes.text).error, /refused/);
  const show = await post(hub.port, "/api/scene/show", { host, origin: EVIL, body: '{"name":"Pwned"}' });
  assert.equal(show.status, 403);
  for (const method of ["PUT", "PATCH", "DELETE"]) {
    assert.equal((await send(hub.port, { method, path: "/api/state", host, origin: EVIL, body: "{}" })).status, 403, method);
  }
  const state = JSON.parse((await send(hub.port, { path: "/api/state", host })).text);
  assert.notEqual(state.sceneLocation, "Pwned");
  await hub.waitForLog(/Refused POST \/api\/foundry\/eval from Origin "https:\/\/evil\.example"/);
});

test("a cross-origin WebSocket from another site is refused with 403", async () => {
  assert.equal((await upgrade(hub.port, { host: `localhost:${hub.port}`, origin: EVIL })).status, 403);
  // Another port on the same machine is another origin.
  assert.equal((await upgrade(hub.port, { host: `localhost:${hub.port}`, origin: "http://localhost:8080" })).status, 403);
});

test("the Kenku FM passthrough, routed before the API, refuses another site too", async () => {
  const from = { host: `localhost:${hub.port}`, origin: EVIL };
  for (const method of ["POST", "PUT"]) {
    const res = await send(hub.port, { method, path: "/api/kenku/v1/playlist/play", body: '{"id":"x"}', ...from });
    assert.equal(res.status, 403, method);
  }
});

test("Foundry's origins are allowed by default, for the WebSocket and a POST", async () => {
  for (const origin of [FOUNDRY, "http://127.0.0.1:30000"]) {
    const from = { host: `localhost:${hub.port}`, origin };
    assert.equal((await upgrade(hub.port, from)).status, 101, `WebSocket from ${origin}`);
    assert.equal((await post(hub.port, "/api/scene/hide", from)).status, 200, `POST from ${origin}`);
  }
});

test("a request with no Origin (curl, a script) is allowed", async () => {
  const host = `localhost:${hub.port}`;
  assert.equal((await post(hub.port, "/api/scene/hide", { host })).status, 200);
  assert.equal((await upgrade(hub.port, { host })).status, 101);
});

test("Origin: null is refused, for a POST and the WebSocket", async () => {
  const from = { host: `localhost:${hub.port}`, origin: "null" };
  assert.equal((await post(hub.port, "/api/scene/hide", from)).status, 403);
  assert.equal((await upgrade(hub.port, from)).status, 403);
});

test("a GET from another origin is answered, with no CORS header to let that page read it", async () => {
  const res = await send(hub.port, { path: "/api/state", host: `localhost:${hub.port}`, origin: EVIL });
  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("a Host that isn't the hub's is refused with 421 (DNS rebinding)", async () => {
  for (const host of [`evil.example:${hub.port}`, `localhost:${hub.port + 1}`, "localhost", `${TAILNET}`, "bad host"]) {
    const self = `http://${host}`;
    assert.equal((await send(hub.port, { path: "/api/state", host })).status, 421, `GET, Host ${host}`);
    assert.equal((await post(hub.port, "/api/scene/hide", { host, origin: self })).status, 421, `POST, Host ${host}`);
    assert.equal((await upgrade(hub.port, { host, origin: self })).status, 421, `WebSocket, Host ${host}`);
  }
  await hub.waitForLog(/Refused GET for Host "evil\.example:\d+"/);
});

// ── The hub configured for a phone over Tailscale ──

test("a configured Tailscale host and origin are allowed; others still aren't", async () => {
  const ts = await startHub({
    ALLOWED_HOSTS: TAILNET,
    ALLOWED_ORIGINS: `${FOUNDRY},http://127.0.0.1:30000,https://${TAILNET}`,
  });
  try {
    // tailscale serve keeps the tailnet's Host; the page's origin is https.
    const phone = { host: TAILNET, origin: `https://${TAILNET}` };
    assert.equal((await send(ts.port, { path: "/gm", host: TAILNET })).status, 200);
    assert.equal((await post(ts.port, "/api/scene/hide", phone)).status, 200);
    assert.equal((await upgrade(ts.port, phone)).status, 101);
    // Straight to the hub's port over the tailnet, the page is the hub's own.
    const direct = { host: `${TAILNET}:${ts.port}`, origin: `http://${TAILNET}:${ts.port}` };
    assert.equal((await post(ts.port, "/api/scene/hide", direct)).status, 200);
    // Foundry still works, kept in the list.
    assert.equal((await upgrade(ts.port, { host: `localhost:${ts.port}`, origin: FOUNDRY })).status, 101);
    // Another site is still refused, whichever host it names.
    assert.equal((await post(ts.port, "/api/scene/hide", { host: TAILNET, origin: EVIL })).status, 403);
    assert.equal((await upgrade(ts.port, { host: TAILNET, origin: EVIL })).status, 403);
    assert.equal((await send(ts.port, { path: "/api/state", host: "other.tail1234.ts.net" })).status, 421);
    assert.match(ts.log(), /Other hosts allowed \(ALLOWED_HOSTS\): +krypton\.tail1234\.ts\.net/);
  } finally {
    await ts.stop();
  }
});

test("ALLOWED_ORIGINS replaces Foundry's default; a host's port is dropped; bad entries are ignored with a warning", async () => {
  const other = await startHub({
    ALLOWED_ORIGINS: "http://localhost:30001, not-an-origin",
    ALLOWED_HOSTS: `${TAILNET}:443, bad host`,
  });
  try {
    const host = `localhost:${other.port}`;
    assert.equal((await upgrade(other.port, { host, origin: "http://localhost:30001" })).status, 101);
    assert.equal((await upgrade(other.port, { host, origin: FOUNDRY })).status, 403);
    // Written with :443, the name is still allowed as a browser behind tailscale serve sends it: with no port.
    assert.equal((await send(other.port, { path: "/api/state", host: TAILNET })).status, 200);
    await other.waitForLog(/ALLOWED_ORIGINS: ignoring "not-an-origin"/);
    await other.waitForLog(/ALLOWED_HOSTS: "krypton\.tail1234\.ts\.net:443" allows krypton\.tail1234\.ts\.net on any port/);
    await other.waitForLog(/ALLOWED_HOSTS: ignoring "bad host"/);
  } finally {
    await other.stop();
  }
});

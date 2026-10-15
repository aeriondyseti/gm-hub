import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { buildSpec } from "./openapi.js";

const DATA_DIR = join(import.meta.dir, "data");
const DATA_PATH = join(DATA_DIR, "state.json");
const PRESETS_PATH = join(DATA_DIR, "presets.json");
const MACROS_PATH = join(DATA_DIR, "macros.json");
const CLIENTS_DIR = join(import.meta.dir, "clients");
const PORT = Number(process.env.PORT) || 3001;
const KENKU_URL = process.env.KENKU_URL || "http://localhost:3333";

// Mood keys the overlay knows how to render (MOODS in clients/overlay.html).
const MOODS = ["neutral", "tense", "mysterious", "festive", "somber", "dangerous"];

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_STATE = {
  sceneVisible: false,
  sceneLocation: "",
  sceneSubtitle: "",
  npcVisible: false,
  npcName: "",
  npcTitle: "",
  mood: "neutral",
  loreFeed: [],
  loreNextId: 0,
  session: "12",
};

const DEFAULT_MACROS = [
  { id: "combat-start", label: "Combat Start", glyph: "⚔", actions: [{ state: { mood: "tense" } }] },
  { id: "combat-end", label: "Combat End", glyph: "🕊", actions: [{ state: { mood: "neutral", npcVisible: false } }] },
  { id: "dramatic-reveal", label: "Dramatic Reveal", glyph: "✦", actions: [{ state: { mood: "mysterious" } }] },
  { id: "session-reset", label: "Session Reset", glyph: "↺", actions: [{ state: { mood: "neutral", npcVisible: false } }, { lore: "clear" }] },
];

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveState(data) {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

let state = readJson(DATA_PATH, { ...DEFAULT_STATE });

// Presets and macros are read from disk on every use so hand edits to the
// JSON files take effect without a restart.
function loadPresets() {
  return { npcs: [], locations: [], lore: [], ...readJson(PRESETS_PATH, {}) };
}
function savePresets(presets) {
  writeFileSync(PRESETS_PATH, JSON.stringify(presets, null, 2));
  broadcast({ type: "presets-update", presets });
  return presets;
}
function loadMacros() {
  return readJson(MACROS_PATH, DEFAULT_MACROS);
}

// Every open WebSocket — browser clients (overlay/gm panel) AND named
// peers (foundry, hex, …). Used for state/event broadcast.
const sockets = new Set();

// Named peers only: peer name → its WebSocket. A peer joins this map by
// sending `{type:"identify", peer:"<name>"}`. Commands are routed here.
const peers = new Map();

// In-flight HTTP→peer commands awaiting their `peer-event` reply, keyed by
// requestId. Each entry: { resolve, timeout }.
const pendingResponses = new Map();
let nextRequestId = 1;

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

// Tell every open socket whether a named peer is connected.
function broadcastPeerStatus(name, connected) {
  broadcast({ type: "peer-status", peer: name, connected });
}

// Route a command to a named peer and wait (up to 10s) for the matching
// `peer-event` reply. Returns the reply object, or `{error, status}` on
// peer-not-connected (503) / timeout (504). The peer must echo the requestId.
function routeCommandToPeer(name, command, params) {
  const ws = peers.get(name);
  if (!ws || ws.readyState !== 1) {
    return Promise.resolve({ error: `peer "${name}" not connected`, status: 503 });
  }
  const requestId = `req-${nextRequestId++}`;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(requestId);
      resolve({ error: `timeout waiting for peer "${name}"`, status: 504 });
    }, 10000);
    pendingResponses.set(requestId, { resolve, timeout });
    ws.send(JSON.stringify({
      type: "peer-command",
      target: name,
      command,
      requestId,
      ...params,
    }));
  });
}

// Flatten a bridge reply into `{ok, ...resultFields}` or `{ok:false, error}`.
// Failures carry the HTTP status to use as a non-enumerable `status`, so it
// stays out of JSON when the result is nested in a larger response.
function peerResult(reply) {
  if (reply.event === "command-ok") {
    const { type, source, event, requestId, ...rest } = reply;
    return { ok: true, ...rest };
  }
  const fail = (error, status) => Object.defineProperty({ ok: false, error }, "status", { value: status });
  if (reply.event === "command-error") return fail(reply.error, 422);
  if (reply.event === "unknown-command") return fail(`Foundry bridge has no "${reply.command}" command`, 501);
  return fail(reply.error || "no reply", reply.status || 502);
}

async function foundry(command, params) {
  return peerResult(await routeCommandToPeer("foundry", command, params));
}

// ── State mutations (shared by WS clients, REST and macros) ──

function setState(changes) {
  Object.assign(state, changes);
  saveState(state);
  broadcast({ type: "state-update", state });
  return state;
}

function pushLore(text) {
  const entry = { id: state.loreNextId++, text, fadingOut: false };
  return setState({ loreFeed: [...state.loreFeed, entry].slice(-6) });
}

function clearLore() {
  return setState({ loreFeed: [] });
}

// ── HTTP helpers ──

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const body = JSON.parse(text);
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {}
  throw new HttpError(400, "Request body must be a JSON object");
}

function requireText(body, field) {
  const v = body[field];
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `"${field}" is required`);
  return v.trim();
}

function optionalText(body, field, fallback = "") {
  const v = body[field];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string") throw new HttpError(400, `"${field}" must be a string`);
  return v.trim();
}

function queueIndex(params, queue) {
  const i = Number(params.index);
  if (!Number.isInteger(i) || i < 0 || i >= queue.length) {
    throw new HttpError(404, `No queued lore entry at index ${params.index} (queue has ${queue.length})`);
  }
  return i;
}

const LISTS = { locations: "location", npcs: "NPC" };

function presetList(params) {
  if (!(params.list in LISTS)) throw new HttpError(404, `Unknown preset list "${params.list}" (use locations or npcs)`);
  return params.list;
}

function findPreset(list, name) {
  const wanted = name.trim().toLowerCase();
  const p = (loadPresets()[list] || []).find((x) => x.name.toLowerCase() === wanted);
  if (!p) throw new HttpError(404, `No ${LISTS[list]} preset named "${name}"`);
  return p;
}

// Kenku FM remote API, via the hub. The caller may point at a different
// Kenku instance with an X-Kenku-Url header.
async function kenku(req, method, path, body) {
  const base = req.headers.get("x-kenku-url") || KENKU_URL;
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    throw new HttpError(502, `Kenku FM not reachable at ${base} — is it running with its remote API enabled?`);
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { body: text }; }
  if (!res.ok) throw new HttpError(502, `Kenku FM returned ${res.status}: ${data.message || text}`);
  return data;
}

// ── Routes ──

const routes = [];
function route(method, path, handler) {
  const keys = [];
  const re = new RegExp("^" + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  routes.push({ method, path, re, keys, handler });
}

const spec = buildSpec({ port: PORT, moods: MOODS, kenkuUrl: KENKU_URL });

route("GET", "/api", () => ({
  description: "Keys to Perfection hub API. Full OpenAPI 3.1 spec at /api/openapi.json.",
  openapi: "/api/openapi.json",
  endpoints: Object.entries(spec.paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(([method]) => ["get", "put", "post", "delete"].includes(method))
      .map(([method, op]) => `${method.toUpperCase()} ${path} — ${op.summary}`)),
}));
route("GET", "/api/openapi.json", () => spec);

route("GET", "/api/status", async () => {
  let kenkuOk = false;
  try {
    kenkuOk = (await fetch(`${KENKU_URL}/v1/playlist`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {}
  return { hub: true, peers: [...peers.keys()], foundry: peers.has("foundry"), kenku: kenkuOk, moods: MOODS, state };
});

// State
route("GET", "/api/state", () => state);
route("PUT", "/api/state", async (req) => setState(await readBody(req)));
route("PUT", "/api/mood", async (req) => {
  const { mood } = await readBody(req);
  if (!MOODS.includes(mood)) throw new HttpError(400, `"mood" must be one of: ${MOODS.join(", ")}`);
  return setState({ mood });
});
route("PUT", "/api/session", async (req) => {
  const { session } = await readBody(req);
  if (typeof session !== "string" && typeof session !== "number") throw new HttpError(400, `"session" is required`);
  return setState({ session: String(session).trim() });
});

// Scene (location banner)
route("POST", "/api/scene/show", async (req) => {
  const body = await readBody(req);
  const preset = body.preset ? findPreset("locations", requireText(body, "preset")) : {};
  const name = body.name !== undefined ? requireText(body, "name") : preset.name;
  if (!name) throw new HttpError(400, `"name" or "preset" is required`);
  const subtitle = optionalText(body, "subtitle", preset.subtitle || "");
  const foundryScene = optionalText(body, "foundryScene", preset.foundryScene || "");
  const result = { state: setState({ sceneLocation: name, sceneSubtitle: subtitle, sceneVisible: true }) };
  if (foundryScene) result.foundry = await foundry("activate-scene", { sceneName: foundryScene });
  return result;
});
route("POST", "/api/scene/hide", () => setState({ sceneVisible: false }));

// NPC nameplate
route("POST", "/api/npc/show", async (req) => {
  const body = await readBody(req);
  const preset = body.preset ? findPreset("npcs", requireText(body, "preset")) : {};
  const name = body.name !== undefined ? requireText(body, "name") : preset.name;
  if (!name) throw new HttpError(400, `"name" or "preset" is required`);
  const title = optionalText(body, "title", preset.title || "");
  const foundryName = optionalText(body, "foundryName", preset.foundryName || "");
  const result = { state: setState({ npcName: name, npcTitle: title, npcVisible: true }) };
  if (body.portrait !== false) result.foundry = await foundry("show-portrait", { actorName: foundryName || name });
  return result;
});
route("POST", "/api/npc/hide", () => setState({ npcVisible: false }));

// Lore feed (on screen) and queue (staged in presets.json)
route("GET", "/api/lore", () => ({ feed: state.loreFeed, queue: loadPresets().lore || [] }));
route("POST", "/api/lore/push", async (req) => pushLore(requireText(await readBody(req), "text")));
route("POST", "/api/lore/clear", () => clearLore());
route("GET", "/api/lore/queue", () => loadPresets().lore || []);
route("POST", "/api/lore/queue", async (req) => {
  const text = requireText(await readBody(req), "text");
  const presets = loadPresets();
  presets.lore = [...(presets.lore || []), text];
  return savePresets(presets).lore;
});
route("POST", "/api/lore/queue/next", () => {
  const presets = loadPresets();
  if (!presets.lore?.length) throw new HttpError(409, "Lore queue is empty");
  const text = presets.lore.shift();
  savePresets(presets);
  return { pushed: text, state: pushLore(text), queue: presets.lore };
});
route("POST", "/api/lore/queue/:index/push", (req, params) => {
  const presets = loadPresets();
  const [text] = presets.lore.splice(queueIndex(params, presets.lore || []), 1);
  savePresets(presets);
  return { pushed: text, state: pushLore(text), queue: presets.lore };
});
route("DELETE", "/api/lore/queue/:index", (req, params) => {
  const presets = loadPresets();
  presets.lore.splice(queueIndex(params, presets.lore || []), 1);
  return savePresets(presets).lore;
});

// Presets (location + NPC library)
route("GET", "/api/presets", () => loadPresets());
route("PUT", "/api/presets", async (req) => savePresets(await readBody(req)));
route("GET", "/api/presets/:list", (req, params) => loadPresets()[presetList(params)] || []);
route("POST", "/api/presets/:list", async (req, params) => {
  const list = presetList(params);
  const body = await readBody(req);
  const item = list === "locations"
    ? { name: requireText(body, "name"), subtitle: optionalText(body, "subtitle") }
    : { name: requireText(body, "name"), title: optionalText(body, "title") };
  const vttKey = list === "locations" ? "foundryScene" : "foundryName";
  const vtt = optionalText(body, vttKey);
  if (vtt) item[vttKey] = vtt;
  // Upsert by name (case-insensitive) so saving an existing preset edits it.
  const presets = loadPresets();
  const items = presets[list] || (presets[list] = []);
  const i = items.findIndex((x) => x.name.toLowerCase() === item.name.toLowerCase());
  if (i >= 0) items[i] = item;
  else items.push(item);
  return savePresets(presets)[list];
});
route("DELETE", "/api/presets/:list/:name", (req, params) => {
  const list = presetList(params);
  const name = decodeURIComponent(params.name);
  const presets = loadPresets();
  const items = presets[list] || [];
  const i = items.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
  if (i < 0) throw new HttpError(404, `No ${LISTS[list]} preset named "${name}"`);
  items.splice(i, 1);
  return savePresets(presets)[list];
});

// Macros (data/macros.json)
route("GET", "/api/macros", () => loadMacros());
route("POST", "/api/macros/:id/run", async (req, params) => {
  const macro = loadMacros().find((m) => m.id === params.id);
  if (!macro) throw new HttpError(404, `No macro "${params.id}" (GET /api/macros lists them)`);
  const results = [];
  for (const a of macro.actions) {
    if (a.state) { setState(a.state); results.push({ state: a.state }); }
    else if (a.lore === "clear") { clearLore(); results.push({ lore: "clear" }); }
    else if (a.lorePush) { pushLore(a.lorePush); results.push({ lorePush: a.lorePush }); }
    else if (a.foundry) {
      const { foundry: command, ...params } = a;
      results.push({ foundry: command, ...(await foundry(command, params)) });
    }
  }
  return { macro: macro.id, results, state };
});

// Audio (Kenku FM)
route("GET", "/api/audio", (req) => kenku(req, "GET", "/v1/playlist/playback"));
route("GET", "/api/audio/playlists", (req) => kenku(req, "GET", "/v1/playlist"));
route("POST", "/api/audio/play", async (req) => {
  const { id } = await readBody(req);
  if (id) await kenku(req, "PUT", "/v1/playlist/play", { id: String(id) });
  else await kenku(req, "PUT", "/v1/playlist/playback/play");
  return { playing: true, ...(id ? { id: String(id) } : {}) };
});
route("POST", "/api/audio/pause", async (req) => {
  await kenku(req, "PUT", "/v1/playlist/playback/pause");
  return { playing: false };
});
route("POST", "/api/audio/toggle", async (req) => {
  const { playing } = await kenku(req, "GET", "/v1/playlist/playback");
  await kenku(req, "PUT", `/v1/playlist/playback/${playing ? "pause" : "play"}`);
  return { playing: !playing };
});
route("PUT", "/api/audio/volume", async (req) => {
  const { volume } = await readBody(req);
  if (typeof volume !== "number" || volume < 0 || volume > 100) throw new HttpError(400, `"volume" must be a number from 0 to 100`);
  await kenku(req, "PUT", "/v1/playlist/playback/volume", { volume: volume / 100 });
  return { volume };
});

// Foundry VTT (through the ktp-foundry-bridge peer)
const FOUNDRY_COMMANDS = {
  roll: ["roll", "formula"],
  chat: ["send-chat", "message"],
  macro: ["execute-macro", "macroName"],
  scene: ["activate-scene", "sceneName"],
  portrait: ["show-portrait", "actorName"],
  eval: ["eval", "code"],
};
for (const [path, [command, field]] of Object.entries(FOUNDRY_COMMANDS)) {
  route("POST", `/api/foundry/${path}`, async (req) => {
    const value = requireText(await readBody(req), field);
    const result = await foundry(command, { [field]: value });
    if (!result.ok) throw new HttpError(result.status, result.error);
    return result;
  });
}

// Generic peer command, e.g. POST /api/peers/foundry/command {command, ...params}
route("POST", "/api/peers/:name/command", async (req, params) => {
  const name = decodeURIComponent(params.name);
  if (!peers.has(name)) throw new HttpError(503, `peer "${name}" not connected`);
  const { command, ...rest } = await readBody(req);
  if (!command) throw new HttpError(400, `"command" is required`);
  const reply = await routeCommandToPeer(name, command, rest);
  const { status, ...body } = reply;
  return Response.json(body, { status: reply.error ? status || 504 : 200 });
});

async function handleApi(req, url) {
  let pathMatched = false;
  for (const r of routes) {
    const m = url.pathname.match(r.re);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== req.method) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
    try {
      const out = await r.handler(req, params, url);
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      console.error(`${req.method} ${url.pathname}:`, e);
      return Response.json({ error: e.message }, { status: 500 });
    }
  }
  return pathMatched
    ? Response.json({ error: `${req.method} not allowed on ${url.pathname}` }, { status: 405 })
    : Response.json({ error: `No endpoint ${url.pathname} — GET /api lists them` }, { status: 404 });
}

// Raw passthrough to Kenku FM for anything the /api/audio endpoints don't
// cover. Target base URL from the X-Kenku-Url header (default KENKU_URL).
async function kenkuProxy(req, url) {
  const kenkuBase = req.headers.get("x-kenku-url") || KENKU_URL;
  const kenkuPath = url.pathname.replace("/api/kenku", "");
  try {
    const reqBody = req.method !== "GET" ? await req.text() : null;
    const headers = {};
    if (reqBody) headers["Content-Type"] = "application/json";
    const kenkuRes = await fetch(`${kenkuBase}${kenkuPath}`, {
      method: req.method,
      headers,
      body: reqBody || undefined,
    });
    const body = await kenkuRes.text();
    return new Response(body, {
      status: kenkuRes.status,
      headers: { "Content-Type": kenkuRes.headers.get("Content-Type") || "application/json" },
    });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 502 });
  }
}

function getMimeType(path) {
  if (path.endsWith(".html")) return "text/html";
  if (path.endsWith(".css")) return "text/css";
  if (path.endsWith(".js")) return "text/javascript";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function serveStatic(path) {
  const filePath = join(CLIENTS_DIR, path);
  if (!filePath.startsWith(CLIENTS_DIR) || !existsSync(filePath)) {
    return new Response("Not Found", { status: 404 });
  }
  const content = readFileSync(filePath);
  return new Response(content, {
    headers: { "Content-Type": getMimeType(path) },
  });
}

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    if (url.pathname.startsWith("/api/kenku/")) return kenkuProxy(req, url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return handleApi(req, url);

    // Static routes. /control and /remote are the old GM pages, now merged into /gm.
    if (["/", "/gm", "/control", "/remote"].includes(url.pathname)) {
      return serveStatic("gm.html");
    }
    if (url.pathname === "/overlay") {
      return serveStatic("overlay.html");
    }

    return serveStatic(url.pathname.slice(1));
  },
  websocket: {
    idleTimeout: 120,
    open(ws) {
      sockets.add(ws);
      ws.send(JSON.stringify({ type: "state-update", state }));
      // Tell the newcomer which peers are already online.
      for (const name of peers.keys()) {
        ws.send(JSON.stringify({ type: "peer-status", peer: name, connected: true }));
      }
    },
    close(ws) {
      sockets.delete(ws);
      // If a named peer dropped, remove it and announce the disconnect.
      if (ws._peerName && peers.get(ws._peerName) === ws) {
        peers.delete(ws._peerName);
        broadcastPeerStatus(ws._peerName, false);
      }
    },
    message(ws, message) {
      try {
        const msg = JSON.parse(message);

        // A peer announces itself: { type:"identify", peer:"<name>" }.
        if (msg.type === "identify" && msg.peer) {
          peers.set(msg.peer, ws);
          ws._peerName = msg.peer;
          broadcastPeerStatus(msg.peer, true);
          return;
        }

        // Route a command to its target peer.
        if (msg.type === "peer-command") {
          const target = peers.get(msg.target);
          if (target && target.readyState === 1) {
            target.send(JSON.stringify(msg));
          }
          return;
        }

        // A peer's event: resolve any waiting HTTP command (matched by
        // requestId), then fan the event out to every other socket so
        // browser clients and sibling peers can react.
        if (msg.type === "peer-event") {
          if (msg.requestId && pendingResponses.has(msg.requestId)) {
            const { resolve, timeout } = pendingResponses.get(msg.requestId);
            clearTimeout(timeout);
            pendingResponses.delete(msg.requestId);
            resolve(msg);
          }
          const payload = JSON.stringify(msg);
          for (const c of sockets) {
            if (c !== ws && c.readyState === 1) c.send(payload);
          }
          return;
        }

        if (msg.type === "update-state") {
          setState(msg.state);
        } else if (msg.type === "push-lore") {
          pushLore(msg.text);
        } else if (msg.type === "clear-lore") {
          clearLore();
        }
      } catch (e) {
        console.error("WS message error:", e);
      }
    },
  },
});

console.log(`Keys to Perfection Hub running on http://localhost:${PORT}`);
console.log(`  Overlay: http://localhost:${PORT}/overlay`);
console.log(`  GM:      http://localhost:${PORT}/gm`);
console.log(`  API:     http://localhost:${PORT}/api  (OpenAPI: /api/openapi.json)`);

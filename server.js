import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_PATH = join(import.meta.dir, "data", "state.json");
const PRESETS_PATH = join(import.meta.dir, "data", "presets.json");
const CLIENTS_DIR = join(import.meta.dir, "clients");
const PORT = Number(process.env.PORT) || 3001;

// Ensure data dir exists
const dataDir = join(import.meta.dir, "data");
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

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

function loadState() {
  if (!existsSync(DATA_PATH)) return { ...DEFAULT_STATE };
  try {
    return JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(data) {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

let state = loadState();

// Every open WebSocket — browser clients (overlay/control/remote) AND
// named peers (foundry, hex, …). Used for state/event broadcast.
const sockets = new Set();

// Named peers only: peer name → its WebSocket. A peer joins this map by
// sending `{type:"identify", peer:"<name>"}`. Commands are routed here.
const peers = new Map();

// In-flight HTTP→peer commands awaiting their `peer-event` reply, keyed by
// requestId. Each entry: { resolve, timeout }. Replaces the old per-socket
// `_httpHandler` slot, which clobbered itself under concurrent commands.
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
  broadcast({ type: 'peer-status', peer: name, connected });
}

// Route a command to a named peer and wait (up to 10s) for the matching
// `peer-event` reply. Returns the reply object, or an `{error}` object on
// timeout / peer-not-connected. The peer must echo the requestId back.
function routeCommandToPeer(name, command, params) {
  const ws = peers.get(name);
  if (!ws || ws.readyState !== 1) {
    return Promise.resolve({ error: `peer "${name}" not connected` });
  }
  const requestId = `req-${nextRequestId++}`;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingResponses.delete(requestId);
      resolve({ error: `timeout waiting for peer "${name}"` });
    }, 10000);
    pendingResponses.set(requestId, { resolve, timeout });
    ws.send(JSON.stringify({
      type: 'peer-command',
      target: name,
      command,
      requestId,
      ...params,
    }));
  });
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

    // API: presets
    if (url.pathname === "/api/presets" && req.method === "GET") {
      try {
        const presets = JSON.parse(readFileSync(PRESETS_PATH, "utf-8"));
        return Response.json(presets);
      } catch {
        return Response.json({ npcs: [], locations: [], lore: [] });
      }
    }
    if (url.pathname === "/api/presets" && req.method === "PUT") {
      return req.json().then((body) => {
        writeFileSync(PRESETS_PATH, JSON.stringify(body, null, 2));
        return Response.json(body);
      });
    }

    // API: get state
    if (url.pathname === "/api/state" && req.method === "GET") {
      return Response.json(state);
    }

    // API: update state (partial merge)
    if (url.pathname === "/api/state" && req.method === "PUT") {
      return req.json().then((body) => {
        Object.assign(state, body);
        saveState(state);
        broadcast({ type: "state-update", state });
        return Response.json(state);
      });
    }

    // API: push lore entry
    if (url.pathname === "/api/lore/push" && req.method === "POST") {
      return req.json().then((body) => {
        const entry = { id: state.loreNextId++, text: body.text, fadingOut: false };
        state.loreFeed = [...state.loreFeed, entry].slice(-6);
        saveState(state);
        broadcast({ type: "state-update", state });
        return Response.json(state);
      });
    }

    // API: clear lore feed
    if (url.pathname === "/api/lore/clear" && req.method === "POST") {
      state.loreFeed = [];
      saveState(state);
      broadcast({ type: "state-update", state });
      return Response.json(state);
    }

    // Forward a command to a named peer via HTTP and wait for its reply.
    //   POST /api/peers/:name/command   { command, ...params }
    // The matching `peer-event` (by requestId) resolves the request; a
    // missing/disconnected peer or a 10s silence yields an error status.
    const peerCmdMatch = url.pathname.match(/^\/api\/peers\/([^/]+)\/command$/);
    if (peerCmdMatch && req.method === "POST") {
      const name = decodeURIComponent(peerCmdMatch[1]);
      if (!peers.has(name)) {
        return Response.json({ error: `peer "${name}" not connected` }, { status: 503 });
      }
      const { command, ...params } = await req.json();
      const reply = await routeCommandToPeer(name, command, params);
      const status = reply.error ? 504 : 200;
      return Response.json(reply, { status });
    }

    // Kenku FM proxy – client sends X-Kenku-Url header with the target base URL
    if (url.pathname.startsWith("/api/kenku/")) {
      const kenkuBase = req.headers.get("x-kenku-url") || "http://localhost:3333";
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

    // Static routes
    // /control and /remote are the old GM pages, now merged into /gm.
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
          Object.assign(state, msg.state);
          saveState(state);
          broadcast({ type: "state-update", state });
        } else if (msg.type === "push-lore") {
          const entry = { id: state.loreNextId++, text: msg.text, fadingOut: false };
          state.loreFeed = [...state.loreFeed, entry].slice(-6);
          saveState(state);
          broadcast({ type: "state-update", state });
        } else if (msg.type === "clear-lore") {
          state.loreFeed = [];
          saveState(state);
          broadcast({ type: "state-update", state });
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

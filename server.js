import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_PATH = join(import.meta.dir, "data", "state.json");
const PRESETS_PATH = join(import.meta.dir, "data", "presets.json");
const PUBLIC_DIR = join(import.meta.dir, "public");
const PORT = 3001;

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

const clients = new Set();
let foundryClient = null;

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(payload);
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
  const filePath = join(PUBLIC_DIR, path);
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
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

    // Foundry bridge — forward commands via HTTP and wait for response
    if (url.pathname === "/api/foundry" && req.method === "POST") {
      if (!foundryClient || foundryClient.readyState !== 1) {
        return Response.json({ error: "Foundry not connected" }, { status: 503 });
      }
      const body = await req.json();
      const msg = { type: "foundry-command", ...body };

      // Wait for the foundry-event response
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve(Response.json({ error: "Timeout waiting for Foundry response" }, { status: 504 }));
        }, 10000);

        function handler(ws, message) {
          try {
            const evt = JSON.parse(message);
            if (evt.type !== "foundry-event") return;
            cleanup();
            resolve(Response.json(evt));
          } catch {}
        }

        function cleanup() {
          clearTimeout(timeout);
          foundryClient._httpHandler = null;
        }

        foundryClient._httpHandler = handler;
        foundryClient.send(JSON.stringify(msg));
      });
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
    if (url.pathname === "/" || url.pathname === "/control") {
      return serveStatic("control.html");
    }
    if (url.pathname === "/overlay") {
      return serveStatic("overlay.html");
    }
    if (url.pathname === "/remote") {
      return serveStatic("remote.html");
    }

    return serveStatic(url.pathname.slice(1));
  },
  websocket: {
    idleTimeout: 120,
    open(ws) {
      clients.add(ws);
      ws.send(JSON.stringify({ type: "state-update", state }));
      ws.send(JSON.stringify({ type: "foundry-status", connected: foundryClient !== null }));
    },
    close(ws) {
      clients.delete(ws);
      if (ws === foundryClient) {
        foundryClient = null;
        broadcast({ type: "foundry-status", connected: false });
      }
    },
    message(ws, message) {
      try {
        const msg = JSON.parse(message);

        // Foundry bridge identification
        if (msg.type === "identify" && msg.client === "foundry") {
          foundryClient = ws;
          broadcast({ type: "foundry-status", connected: true });
          return;
        }

        // Route commands to Foundry
        if (msg.type === "foundry-command") {
          if (foundryClient && foundryClient.readyState === 1) {
            foundryClient.send(JSON.stringify(msg));
          }
          return;
        }

        // Broadcast Foundry events to all other clients
        if (msg.type === "foundry-event") {
          // If an HTTP request is waiting for this response, deliver it
          if (ws._httpHandler) {
            ws._httpHandler(ws, message);
          }
          const payload = JSON.stringify(msg);
          for (const c of clients) {
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

console.log(`Keys to Perfection Overlay running on http://localhost:${PORT}`);
console.log(`  Overlay: http://localhost:${PORT}/overlay`);
console.log(`  Control: http://localhost:${PORT}/control`);
console.log(`  Remote:  http://localhost:${PORT}/remote`);

# ktp-hub

The session-state hub for **Keys to Perfection**. Bun server on port
`3001` that owns the shared session state, broadcasts changes over
WebSocket, and acts as the message bus between named **peers**
(Foundry bridge, hexploration, future tools).

The hub is also the host for two browser **clients**: the OBS overlay
and the GM panel. The overlay is the hub's canonical *projection* — its
read-only render targeting OBS. The GM panel is the GM's *input* surface
(it replaced the old separate control and remote pages) and may
eventually move to a sibling `ktp-console/` repo (see backlog in
`../hexploration/ROADMAP.md`).

## Taxonomy

| Term     | What                                                | Examples                              |
|----------|-----------------------------------------------------|---------------------------------------|
| **Hub**  | This server. Owns state, runs the bus + REST + WS.  | `ktp-hub/` (this repo)                |
| **Peers**| WS-connected tools exchanging commands and events.  | `ktp-foundry-bridge`, `hexploration`  |
| **Clients** | Browser pages that consume the hub's HTTP+WS.    | `overlay.html`, `gm.html` |

Peers are symmetric on the wire — any peer can send commands or events
at any time. The hub routes between them. Clients are HTTP/WS consumers
that display state and POST mutations; they don't participate in the
peer protocol.

## Sibling repos

Lives in `~/Development/ktp/` alongside:

- **`../hexploration/`** — TTRPG hexploration tool. Will connect as the
  `hex` peer and emit typed events that map onto overlay surfaces
  (e.g. `day-advanced` → scene banner). See `../hexploration/ROADMAP.md`.
- **`../ktp-foundry-bridge/`** — Foundry VTT module that connects as the
  `foundry` peer. Exposes a command registry; routes commands from the
  hub into Foundry and events from Foundry out to other peers.

The `~/Development/ktp/README.md` has a system diagram.

## Layout

```
ktp-hub/
├── server.js              — Bun server: REST routes, WS bus, peer routing
├── openapi.js             — OpenAPI spec for /api (keep in step with routes)
├── package.json           — bun runtime only, no deps
├── clients/               — browser pages served by the hub
│   ├── overlay.html       — transparent OBS browser source projection
│   └── gm.html            — GM panel: narrow side-strip for a big-screen TV
│                            (preview, macros, mood, scene, NPC, lore, Kenku, Foundry)
└── data/
    ├── state.json         — runtime session state (scene/NPC/mood/lore)
    ├── presets.json       — NPC and location library + lore queue
    └── macros.json        — GM macros (overlay/lore/Foundry action lists)
```

## Commands

```bash
bun run server.js          # starts on :3001
# or
npm start                  # same thing (package.json script wraps it)
PORT=3002 bun run server.js  # alternate port, e.g. to test a worktree
```

Then open:
- http://localhost:3001/overlay  (set as OBS browser source)
- http://localhost:3001/gm  (`/`, `/control` and `/remote` serve it too)

## Protocol (v1.4+)

Peers connect to `ws://localhost:3001/ws` and identify themselves:

```json
{ "type": "identify", "peer": "foundry" }
```

The hub maintains a `peers` registry and routes generalized messages
between them.

### Hub → peer

```json
{
  "type": "peer-command",
  "target": "foundry",
  "command": "show-portrait",
  "requestId": "req-42",
  "actorName": "Amara"
}
```

### Peer → hub

```json
{
  "type": "peer-event",
  "source": "foundry",
  "event": "command-ok",
  "requestId": "req-42",
  "command": "show-portrait"
}
```

When a `peer-event` carries a `requestId` that matches a pending HTTP
request (see below), the hub resolves it. Either way the event is
broadcast to every other connected socket — both peers and clients —
so anyone listening can react.

### Hub broadcasts (status)

```json
{ "type": "peer-status", "peer": "foundry", "connected": true }
```

Fired when any named peer connects or disconnects. On open, the hub
sends one `peer-status` per known peer so the new connection knows
who's online.

## HTTP API

Every GM-panel action is a REST endpoint, documented as OpenAPI 3.1 at
`GET /api/openapi.json` (built in `openapi.js`) with a one-line-per-endpoint
index at `GET /api`. The GM panel itself uses these endpoints, so anything
it can do is scriptable with `curl` (e.g. by an LLM). Groups:

- **Status/overlay** — `/api/status`, `/api/state`, `/api/mood`,
  `/api/session`, `/api/scene/show|hide`, `/api/npc/show|hide`. Scene and
  NPC shows also drive Foundry (scene activation, portrait).
- **Lore** — `/api/lore/push|clear` (on screen, capped at 6) and
  `/api/lore/queue…` (staged lines, stored in `presets.json` `lore`).
- **Presets** — `/api/presets/{locations|npcs}`, upsert/delete by name.
- **Macros** — `/api/macros`, `/api/macros/{id}/run`; defined in
  `data/macros.json`.
- **Audio** — `/api/audio…` wraps Kenku FM's remote API (default
  `KENKU_URL` = `http://localhost:3333`, per-request `X-Kenku-Url`
  header overrides). `/api/kenku/*` remains a raw passthrough.
- **Foundry** — `/api/foundry/{roll|chat|macro|scene|portrait|eval}`
  send bridge commands and wait for the reply; `/api/peers/:name/command`
  is the generic form. 503 = bridge not connected, 504 = no reply in 10s,
  422 = the command failed in Foundry.

Errors are always `{"error": "..."}`. State changes broadcast
`state-update`; preset/queue changes broadcast `presets-update`.
Adding an endpoint: add a `route(...)` in `server.js` **and** its entry in
`openapi.js`.

## Things to know

- **State is opaque to peers.** Only browser clients introspect
  `state.json`. Peers exchange peer-* messages and don't see the hub's
  state directly.
- **`requestId` is required** for any command that expects a response.
  The hub keys pending responses by it; without it, an HTTP forward
  always times out at 10s. Peers respond by echoing back the same
  `requestId` in their `peer-event`.
- **Bun-specific APIs.** `import.meta.dir`, `Bun.serve`,
  `server.upgrade()`. Not Node-compatible without a runtime swap.
- **No build step.** Edit `server.js` and restart; edit a
  `clients/*.html` and refresh.
- **Known security issue (open; from Sable's review 0.4.106 M2, her
  ADR-0512; moved here 2026-10-16).** The hub listens on every network
  interface (`Bun.serve` with no `hostname`), has no authentication and
  no `Origin` check, and broadcasts every peer reply to all other
  sockets. While it runs, anything that can reach port `3001` on the
  network can run `eval` in the GM's browser through the Foundry bridge
  and read what that browser reads, GM-only content included. Fix: bind
  `127.0.0.1`; refuse a browser `Origin` on `/api/peers/*`; answer a
  command's reply only to the HTTP caller that sent it, not to every
  socket. Do this before the hub runs on a network that isn't trusted.

## Connected peers

| Peer name  | Repo                       | Status                         |
|------------|----------------------------|--------------------------------|
| `foundry`  | `../ktp-foundry-bridge/`   | v1.4.0+ (uses generalized API) |
| `hex`      | `../hexploration/`         | planned (see hex Phase 3)      |

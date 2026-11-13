# gm-hub: peer protocol and HTTP API

What is true now, edited in place. This is gm-hub's public surface for outside code: the peers that connect over
WebSocket (today the Foundry bridge) and anything that calls the REST API. The rules for changing it are in
AGENTS.md.

The hub serves on port `3001` (`PORT` overrides it): the overlay at `/overlay` (an OBS browser source), the GM panel
at `/gm` (`/`, `/control` and `/remote` serve it too), the API under `/api`, and the WebSocket at `/ws`.

Who may connect is set by the hub's `Host` and `Origin` checks and their two settings, `ALLOWED_HOSTS` and
`ALLOWED_ORIGINS` (`docs/security.md`). For a peer: one running in a browser page, as the Foundry bridge
does, connects from its page's origin, which must be allowed (Foundry's on port 30000 is by default); any peer that
reaches the hub by a name other than `localhost`, `127.0.0.1` or `[::1]` needs that name in `ALLOWED_HOSTS`.

## Peer protocol (v1.4+)

Peers connect to `ws://localhost:3001/ws` and identify themselves:

```json
{ "type": "identify", "peer": "foundry" }
```

The hub keeps a `peers` registry and routes generalized messages between them. Peers are symmetric on the wire: any
peer can send commands or events at any time.

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

When a `peer-event` carries a `requestId` that matches a pending HTTP request, the hub resolves that request.
Either way the event is broadcast to every other connected socket, peers and clients alike, so anyone listening
can react.

### Hub broadcasts (status)

```json
{ "type": "peer-status", "peer": "foundry", "connected": true }
```

Sent when any named peer connects or disconnects. On open, the hub sends one `peer-status` per known peer so the new
connection knows who is online.

### State messages (any socket)

On open, every connection first gets the whole state, then the `peer-status` messages above:

```json
{ "type": "state-update", "state": { "mood": "neutral", "sceneVisible": false } }
```

`state-update` is also broadcast on every state change. The hub still accepts three state messages from any socket,
peer or client, besides the HTTP API: `{ "type": "update-state", "state": {…} }` merges fields into the state,
`{ "type": "push-lore", "text": "…" }` adds a line to the lore feed, and `{ "type": "clear-lore" }` empties it.

### Connected peers

| Peer name | Repo | Status |
| --- | --- | --- |
| `foundry` | The Foundry bridge (`foundry-bridge/`, module ID `gm-hub-bridge`) | v1.4.0+ (uses the generalized API) |

## HTTP API

Every GM-panel action is a REST endpoint, documented as OpenAPI 3.1 at `GET /api/openapi.json` (built in
`hub/openapi.js`) with a one-line-per-endpoint index at `GET /api`. The GM panel itself uses these endpoints, so
anything it can do is scriptable with `curl` (by an LLM, for instance). Groups:

- **Status and overlay:** `/api/status`, `/api/state`, `/api/mood`, `/api/session`, `/api/scene/show|hide`,
  `/api/npc/show|hide`. Scene and NPC shows also drive Foundry (scene activation, portrait).
- **Lore:** `/api/lore/push|clear` (on screen, capped at 6) and `/api/lore/queue…` (staged lines, stored in
  `presets.json` under `lore`).
- **Presets:** `/api/presets/{locations|npcs}`, upsert and delete by name.
- **Macros:** `/api/macros`, `/api/macros/{id}/run`; defined in `hub/data/macros.json`.
- **Audio:** `/api/audio…` wraps Kenku FM's remote API (default `KENKU_URL` = `http://localhost:3333`; a per-request
  `X-Kenku-Url` header overrides it). `/api/kenku/*` remains a raw passthrough.
- **Foundry:** `/api/foundry/{roll|chat|macro|scene|portrait|eval}` send bridge commands and wait for the reply;
  `/api/peers/:name/command` is the generic form. 503 = the bridge is not connected, 504 = no reply in 10 s,
  422 = the command failed in Foundry.

Errors are always `{"error": "..."}`. State changes broadcast `state-update`; preset and queue changes broadcast
`presets-update`.

## Stored data

| File | Holds |
| --- | --- |
| `hub/data/state.json` | The live session state (scene, NPC, mood, lore feed, session number), rewritten as it changes |
| `hub/data/presets.json` | The NPC and location library, plus the lore queue |
| `hub/data/macros.json` | The GM macros (lists of overlay, lore and Foundry actions) |

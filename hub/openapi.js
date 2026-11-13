// OpenAPI 3.1 description of the hub's REST API, served at /api/openapi.json.
// Built at startup so the mood enum and server URL match the running hub.
// Keep in step with the routes in server.js.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, description = "OK") => ({ description, content: { "application/json": { schema } } });
const body = (schema, required = true) => ({ required, content: { "application/json": { schema } } });
const err = (description) => json(ref("Error"), description);
const obj = (properties, required = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const str = (description, extra = {}) => ({ type: "string", description, ...extra });

const ERR_400 = { 400: err("Missing or invalid field") };
const KENKU_HEADER = {
  name: "X-Kenku-Url", in: "header", required: false,
  description: "Kenku FM remote base URL, if not the hub's default.",
  schema: { type: "string" },
};
const KENKU_ERR = { 502: err("Kenku FM not reachable or returned an error") };
const FOUNDRY_ERR = {
  422: err("The Foundry bridge ran the command but it failed (e.g. no such macro/actor/scene)"),
  501: err("The connected bridge doesn't support this command"),
  503: err("Foundry bridge not connected (Foundry closed, or the world isn't loaded)"),
  504: err("Foundry bridge didn't answer within 10s"),
};

function foundryOp(summary, field, fieldDesc, example, extraOk) {
  return {
    post: {
      tags: ["Foundry"], summary,
      requestBody: body(obj({ [field]: str(fieldDesc, { examples: [example] }) }, [field])),
      responses: { 200: json(extraOk || ref("FoundryResult")), ...ERR_400, ...FOUNDRY_ERR },
    },
  };
}

export function buildSpec({ port, moods, kenkuUrl }) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Keys to Perfection Hub API",
      version: "1.5.0",
      description: [
        "Local control API for the Keys to Perfection live-session hub: the OBS overlay (scene banner,",
        "NPC nameplate, mood, lore feed, session number), the campaign preset library, macros,",
        "Kenku FM audio, and Foundry VTT via the ktp-foundry-bridge module. It can do everything the",
        "GM panel at /gm can do, and the panel uses these same endpoints.",
        "",
        "Conventions: JSON in, JSON out. Errors are `{\"error\": \"...\"}` with a 4xx/5xx status.",
        "Changes go live on the overlay and every open GM panel immediately.",
        "Call it as localhost, 127.0.0.1 or [::1] (another Host gets 421 unless set in ALLOWED_HOSTS).",
        "A change, or the WebSocket at /ws, from a browser page on another origin gets 403 unless that",
        "origin is set in ALLOWED_ORIGINS; curl and scripts send no Origin and pass.",
        "",
        "Quick start:",
        `  curl -s localhost:${port}/api/status`,
        `  curl -s -X PUT localhost:${port}/api/mood -H 'Content-Type: application/json' -d '{"mood":"tense"}'`,
        `  curl -s -X POST localhost:${port}/api/scene/show -H 'Content-Type: application/json' -d '{"preset":"Tower of Aeons"}'`,
        `  curl -s -X POST localhost:${port}/api/lore/push -H 'Content-Type: application/json' -d '{"text":"The key hums."}'`,
        "",
        "Player-visible: anything shown on the overlay, and Foundry chat/scene/portrait commands.",
        "GM-only: presets, the lore queue, macros listing, state reads.",
      ].join("\n"),
    },
    servers: [{ url: `http://localhost:${port}` }],
    tags: [
      { name: "Status" }, { name: "Overlay" }, { name: "Lore" }, { name: "Presets" },
      { name: "Macros" }, { name: "Audio", description: `Kenku FM (default ${kenkuUrl}).` },
      { name: "Foundry", description: "Foundry VTT through the ktp-foundry-bridge peer." },
    ],
    paths: {
      "/api": {
        get: { tags: ["Status"], summary: "One-line index of every endpoint", responses: { 200: json({ type: "object" }) } },
      },
      "/api/openapi.json": {
        get: { tags: ["Status"], summary: "This OpenAPI document", responses: { 200: json({ type: "object" }) } },
      },
      "/api/status": {
        get: {
          tags: ["Status"], summary: "Hub health, connected peers, Kenku reachability, valid moods and current overlay state",
          responses: { 200: json(obj({
            hub: { type: "boolean" },
            peers: { type: "array", items: { type: "string" } },
            foundry: { type: "boolean", description: "Foundry bridge connected" },
            kenku: { type: "boolean", description: "Kenku FM reachable at the default URL" },
            moods: { type: "array", items: { type: "string" } },
            state: ref("State"),
          })) },
        },
      },

      // ── Overlay ──
      "/api/state": {
        get: { tags: ["Overlay"], summary: "Current overlay state", responses: { 200: json(ref("State")) } },
        put: {
          tags: ["Overlay"], summary: "Low-level partial merge into overlay state (prefer the specific endpoints)",
          requestBody: body(ref("StatePatch")),
          responses: { 200: json(ref("State")), ...ERR_400 },
        },
      },
      "/api/mood": {
        put: {
          tags: ["Overlay"], summary: "Set the overlay mood (border/vignette colour)",
          requestBody: body(obj({ mood: { type: "string", enum: moods } }, ["mood"])),
          responses: { 200: json(ref("State")), ...ERR_400 },
        },
      },
      "/api/session": {
        put: {
          tags: ["Overlay"], summary: "Set the session number shown in the overlay corner",
          requestBody: body(obj({ session: { type: ["string", "integer"], examples: ["24"] } }, ["session"])),
          responses: { 200: json(ref("State")), ...ERR_400 },
        },
      },
      "/api/scene/show": {
        post: {
          tags: ["Overlay"],
          summary: "Show the location banner; also activates a Foundry scene when one is given or set on the preset",
          description: "Pass `preset` to use a saved location (name match is case-insensitive), or `name`/`subtitle` for a custom one. Explicit fields override the preset's.",
          requestBody: body(obj({
            preset: str("Name of a saved location preset"),
            name: str("Location name (required unless preset is given)"),
            subtitle: str("Line under the name"),
            foundryScene: str("Foundry scene to activate as well"),
          })),
          responses: {
            200: json(obj({ state: ref("State"), foundry: ref("FoundryResult") }), "Shown. `foundry` is present only when a Foundry scene was requested; check its `ok`."),
            ...ERR_400, 404: err("No preset with that name"),
          },
        },
      },
      "/api/scene/hide": {
        post: { tags: ["Overlay"], summary: "Hide the location banner", responses: { 200: json(ref("State")) } },
      },
      "/api/npc/show": {
        post: {
          tags: ["Overlay"],
          summary: "Show the NPC nameplate; also pops the actor's portrait for players in Foundry",
          description: "Pass `preset` to use a saved NPC, or `name`/`title`. The portrait uses `foundryName` (or the name); set `portrait: false` to skip it.",
          requestBody: body(obj({
            preset: str("Name of a saved NPC preset"),
            name: str("NPC name (required unless preset is given)"),
            title: str("Line under the name"),
            foundryName: str("Foundry actor name for the portrait, if different"),
            portrait: { type: "boolean", default: true, description: "Show the portrait in Foundry" },
          })),
          responses: {
            200: json(obj({ state: ref("State"), foundry: ref("FoundryResult") }), "Shown. `foundry` is present when a portrait was requested; check its `ok`."),
            ...ERR_400, 404: err("No preset with that name"),
          },
        },
      },
      "/api/npc/hide": {
        post: { tags: ["Overlay"], summary: "Hide the NPC nameplate", responses: { 200: json(ref("State")) } },
      },

      // ── Lore ──
      "/api/lore": {
        get: {
          tags: ["Lore"], summary: "Lore entries on screen and the GM's queued entries",
          responses: { 200: json(obj({ feed: { type: "array", items: ref("LoreEntry") }, queue: { type: "array", items: { type: "string" } } })) },
        },
      },
      "/api/lore/push": {
        post: {
          tags: ["Lore"], summary: "Put a lore/quest line on screen now (the feed keeps the last 6)",
          requestBody: body(obj({ text: str("Text to show", { examples: ["Complete the Trial of the Imperial Hall"] }) }, ["text"])),
          responses: { 200: json(ref("State")), ...ERR_400 },
        },
      },
      "/api/lore/clear": {
        post: { tags: ["Lore"], summary: "Remove every lore line from the screen", responses: { 200: json(ref("State")) } },
      },
      "/api/lore/queue": {
        get: { tags: ["Lore"], summary: "Queued (not yet shown) lore lines, in order", responses: { 200: json({ type: "array", items: { type: "string" } }) } },
        post: {
          tags: ["Lore"], summary: "Add a line to the end of the queue (not shown yet)",
          requestBody: body(obj({ text: { type: "string" } }, ["text"])),
          responses: { 200: json({ type: "array", items: { type: "string" } }, "The updated queue"), ...ERR_400 },
        },
      },
      "/api/lore/queue/next": {
        post: {
          tags: ["Lore"], summary: "Show the first queued line and remove it from the queue",
          responses: { 200: json(ref("LorePushResult")), 409: err("Queue is empty") },
        },
      },
      "/api/lore/queue/{index}/push": {
        post: {
          tags: ["Lore"], summary: "Show the queued line at a 0-based index and remove it from the queue",
          parameters: [{ name: "index", in: "path", required: true, schema: { type: "integer", minimum: 0 } }],
          responses: { 200: json(ref("LorePushResult")), 404: err("No entry at that index") },
        },
      },
      "/api/lore/queue/{index}": {
        delete: {
          tags: ["Lore"], summary: "Delete the queued line at a 0-based index without showing it",
          parameters: [{ name: "index", in: "path", required: true, schema: { type: "integer", minimum: 0 } }],
          responses: { 200: json({ type: "array", items: { type: "string" } }, "The updated queue"), 404: err("No entry at that index") },
        },
      },

      // ── Presets ──
      "/api/presets": {
        get: { tags: ["Presets"], summary: "Whole preset library (locations, NPCs, lore queue)", responses: { 200: json(ref("Presets")) } },
        put: {
          tags: ["Presets"], summary: "Replace the whole preset library (prefer the per-item endpoints)",
          requestBody: body(ref("Presets")),
          responses: { 200: json(ref("Presets")), ...ERR_400 },
        },
      },
      "/api/presets/{list}": {
        parameters: [{ name: "list", in: "path", required: true, schema: { type: "string", enum: ["locations", "npcs"] } }],
        get: { tags: ["Presets"], summary: "List location or NPC presets", responses: { 200: json({ type: "array", items: { oneOf: [ref("Location"), ref("Npc")] } }), 404: err("Unknown list") } },
        post: {
          tags: ["Presets"], summary: "Save a preset; replaces any existing preset with the same name (case-insensitive)",
          description: "locations take {name, subtitle, foundryScene}; npcs take {name, title, foundryName}.",
          requestBody: body({ oneOf: [ref("Location"), ref("Npc")] }),
          responses: { 200: json({ type: "array", items: { oneOf: [ref("Location"), ref("Npc")] } }, "The updated list"), ...ERR_400, 404: err("Unknown list") },
        },
      },
      "/api/presets/{list}/{name}": {
        parameters: [
          { name: "list", in: "path", required: true, schema: { type: "string", enum: ["locations", "npcs"] } },
          { name: "name", in: "path", required: true, description: "Preset name, URL-encoded (case-insensitive)", schema: { type: "string" } },
        ],
        delete: {
          tags: ["Presets"], summary: "Delete a preset by name",
          responses: { 200: json({ type: "array", items: { oneOf: [ref("Location"), ref("Npc")] } }, "The updated list"), 404: err("No such preset or list") },
        },
      },

      // ── Macros ──
      "/api/macros": {
        get: { tags: ["Macros"], summary: "List macros (edit data/macros.json to change them)", responses: { 200: json({ type: "array", items: ref("Macro") }) } },
      },
      "/api/macros/{id}/run": {
        post: {
          tags: ["Macros"], summary: "Run a macro's actions in order",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", examples: ["combat-start"] } }],
          responses: {
            200: json(obj({ macro: { type: "string" }, results: { type: "array", items: { type: "object" } }, state: ref("State") })),
            404: err("No macro with that id"),
          },
        },
      },

      // ── Audio ──
      "/api/audio": {
        get: {
          tags: ["Audio"], summary: "Kenku FM playlist playback state (playing, volume, track, …)",
          parameters: [KENKU_HEADER], responses: { 200: json({ type: "object" }), ...KENKU_ERR },
        },
      },
      "/api/audio/playlists": {
        get: {
          tags: ["Audio"], summary: "Kenku FM playlists and tracks (ids for /api/audio/play)",
          parameters: [KENKU_HEADER],
          responses: { 200: json(obj({ playlists: { type: "array", items: obj({ id: { type: "string" }, title: { type: "string" } }) }, tracks: { type: "array", items: { type: "object" } } })), ...KENKU_ERR },
        },
      },
      "/api/audio/play": {
        post: {
          tags: ["Audio"], summary: "Play a playlist or track by id, or resume playback when no id is given",
          parameters: [KENKU_HEADER],
          requestBody: body(obj({ id: str("Playlist or track id from /api/audio/playlists") }), false),
          responses: { 200: json(obj({ playing: { type: "boolean" }, id: { type: "string" } })), ...KENKU_ERR },
        },
      },
      "/api/audio/pause": {
        post: { tags: ["Audio"], summary: "Pause playback", parameters: [KENKU_HEADER], responses: { 200: json(obj({ playing: { type: "boolean" } })), ...KENKU_ERR } },
      },
      "/api/audio/toggle": {
        post: { tags: ["Audio"], summary: "Play if paused, pause if playing", parameters: [KENKU_HEADER], responses: { 200: json(obj({ playing: { type: "boolean" } })), ...KENKU_ERR } },
      },
      "/api/audio/volume": {
        put: {
          tags: ["Audio"], summary: "Set playlist volume, 0–100",
          parameters: [KENKU_HEADER],
          requestBody: body(obj({ volume: { type: "number", minimum: 0, maximum: 100 } }, ["volume"])),
          responses: { 200: json(obj({ volume: { type: "number" } })), ...ERR_400, ...KENKU_ERR },
        },
      },

      // ── Foundry ──
      "/api/foundry/roll": foundryOp("Roll dice in Foundry and post the result to chat", "formula", "Dice formula", "1d20+5",
        obj({ ok: { type: "boolean" }, command: { type: "string" }, formula: { type: "string" }, total: { type: "number" } })),
      "/api/foundry/chat": foundryOp("Post an in-character chat message in Foundry (players see it)", "message", "Message text; Foundry chat commands like /desc work", "/desc The ground trembles."),
      "/api/foundry/macro": foundryOp("Run a Foundry macro by name", "macroName", "Macro name as shown in Foundry", "Initiative"),
      "/api/foundry/scene": foundryOp("Activate a Foundry scene by name (moves players to it)", "sceneName", "Scene name", "Tower of Aeons"),
      "/api/foundry/portrait": foundryOp("Show an actor's portrait to all players", "actorName", "Actor name", "Amara"),
      "/api/foundry/eval": foundryOp("Run JavaScript inside Foundry as the GM (`return` a value to get it back as a string)", "code", "Function body; game, canvas, ui, ChatMessage, Roll are in scope", "return game.world.id",
        obj({ ok: { type: "boolean" }, command: { type: "string" }, result: { type: "string" } })),
      "/api/peers/{name}/command": {
        post: {
          tags: ["Foundry"], summary: "Send any command to a named peer and wait for its reply (low-level)",
          parameters: [{ name: "name", in: "path", required: true, schema: { type: "string", examples: ["foundry"] } }],
          requestBody: body({ type: "object", required: ["command"], properties: { command: { type: "string" } }, additionalProperties: true }),
          responses: { 200: json({ type: "object" }, "The peer's raw peer-event reply"), ...ERR_400, 503: err("Peer not connected"), 504: err("Peer didn't answer within 10s") },
        },
      },
    },
    components: {
      schemas: {
        Error: obj({ error: { type: "string" } }, ["error"]),
        State: obj({
          sceneVisible: { type: "boolean" },
          sceneLocation: { type: "string" },
          sceneSubtitle: { type: "string" },
          npcVisible: { type: "boolean" },
          npcName: { type: "string" },
          npcTitle: { type: "string" },
          mood: { type: "string", enum: moods },
          loreFeed: { type: "array", items: ref("LoreEntry") },
          loreNextId: { type: "integer" },
          session: { type: "string" },
        }),
        StatePatch: {
          type: "object", description: "Any subset of State fields.",
          properties: {
            sceneVisible: { type: "boolean" }, sceneLocation: { type: "string" }, sceneSubtitle: { type: "string" },
            npcVisible: { type: "boolean" }, npcName: { type: "string" }, npcTitle: { type: "string" },
            mood: { type: "string", enum: moods }, session: { type: "string" },
          },
        },
        LoreEntry: obj({ id: { type: "integer" }, text: { type: "string" }, fadingOut: { type: "boolean" } }),
        LorePushResult: obj({ pushed: { type: "string" }, state: ref("State"), queue: { type: "array", items: { type: "string" } } }),
        Location: obj({ name: { type: "string" }, subtitle: { type: "string" }, foundryScene: { type: "string" } }, ["name"]),
        Npc: obj({ name: { type: "string" }, title: { type: "string" }, foundryName: { type: "string" } }, ["name"]),
        Presets: obj({
          locations: { type: "array", items: ref("Location") },
          npcs: { type: "array", items: ref("Npc") },
          lore: { type: "array", items: { type: "string" }, description: "Lore queue" },
        }),
        Macro: obj({
          id: { type: "string" }, label: { type: "string" }, glyph: { type: "string" },
          actions: {
            type: "array",
            description: "Each action is one of {state: StatePatch}, {lore: \"clear\"}, {lorePush: text}, or {foundry: command, ...params}.",
            items: { type: "object" },
          },
        }, ["id", "label", "actions"]),
        FoundryResult: {
          type: "object",
          description: "Bridge reply. `ok` false means it failed; `error` says why.",
          properties: { ok: { type: "boolean" }, command: { type: "string" }, error: { type: "string" } },
          additionalProperties: true,
        },
      },
    },
  };
}

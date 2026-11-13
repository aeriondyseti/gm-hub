# gm-hub: design

What is true now, edited in place. Invariants are rules: they live in AGENTS.md, not here.

## Purpose

The GM's hub for a streamed tabletop session: one place that holds what the stream shows and what the GM controls,
and reaches into Foundry VTT. It supports play without competing with it: controls are quick to use while
attention stays on the people at the table, and the GM gets control while viewers get the view meant for them.

## What is built

**The hub** (`hub/`). Scene banners, NPC nameplates, mood vignettes and a lore feed on the overlay; a GM panel
sized as a narrow strip beside a big-screen TV, with a live preview of the overlay and the OBS virtual camera,
macros, mood, scene and NPC presets, the lore queue, Kenku FM audio, and Foundry commands, chat and eval; a REST
API for every panel action, so the session can be driven with `curl`.

**The Foundry bridge** (`foundry-bridge/`), GM Hub Bridge. A Foundry VTT module that connects Foundry to the hub
as its `foundry` peer and runs the commands the hub sends: show a portrait, run a macro, roll dice, activate a
scene, post chat, run code.

## Public surface

Each component is versioned on its own (`<component>-vX.Y.Z`), against these surfaces. Breaking any of them is
MAJOR (MINOR before 1.0.0).

| Component | Public surface |
| --- | --- |
| hub | The HTTP API (`/api`, OpenAPI 3.1), the WebSocket protocol (v1.4), the client URLs (`/overlay`, `/gm`) and port, and the stored data files: all in `docs/protocol.md` |
| foundry-bridge | The module's ID and setting, its built-in commands, and the object it gives macros (`ktpBridge`, `gmHubBridge`) |

## Architecture

- **hub:** one Bun server (`hub/server.js`, no dependencies) that owns the live session state in `hub/data/`,
  broadcasts every change over WebSocket, routes commands and events between named peers, wraps Kenku FM's remote
  API, and serves two browser clients from `hub/clients/`: the overlay, its read-only projection for OBS, and the
  GM panel, its input surface. Clients are HTTP and WebSocket consumers and take no part in the peer protocol. The
  OpenAPI spec is built in `hub/openapi.js`.
- **foundry-bridge:** one script loaded by Foundry in every client; only a GM's client opens the WebSocket to the
  hub, identifies as `foundry`, runs each `peer-command` and answers with a `peer-event`.

The hub runs on the machine at the table and shares its state with every browser that reaches it; its reach is in
`docs/security.md`.

## Glossary

The only home of the repo's words.

| Word | Meaning | Not |
| --- | --- | --- |
| Component | One separately versioned part of the repo in its own folder, with its own `CHANGELOG.md` and tags: hub, foundry-bridge | |
| Hub | The server in `hub/`: it owns the session state and runs the peer bus, the REST API and the WebSocket | ktp-hub (its name until the rename of 2026-11-12); ktp-overlay (until 2026-06-04) |
| Bridge | GM Hub Bridge, the Foundry VTT module in `foundry-bridge/` | ktp-foundry-bridge (its ID until 2026-11-12) |
| Peer | A tool connected to the hub's WebSocket under a name, exchanging `peer-command` and `peer-event` messages; the bridge is `foundry` | |
| Client | A browser page the hub serves, which reads its HTTP and WebSocket and posts changes; not a peer | |
| GM panel | The hub's input surface for the GM (`/gm`), a narrow strip beside a big-screen TV | control page, remote page (the two pages it replaced) |
| Overlay | The hub's read-only projection for OBS (`/overlay`) | |

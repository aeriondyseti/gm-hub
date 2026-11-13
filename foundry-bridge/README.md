# GM Hub Bridge

A Foundry VTT module (v12 and v13) that connects Foundry to the hub over WebSocket and exposes a command registry.
It lets the GM drive Foundry from the hub's GM panel and lets Foundry push events out to other connected peers.
Its module ID is `gm-hub-bridge`.

| File | What it is |
| --- | --- |
| [`module.json`](module.json) | The Foundry manifest: ID, version, compatible Foundry versions |
| [`scripts/bridge.js`](scripts/bridge.js) | The module: the command registry and the WebSocket client |
| [`CHANGELOG.md`](CHANGELOG.md) | What has changed |

## Built-in commands

| Command | Params | Effect |
| --- | --- | --- |
| `show-portrait` | `actorName` | Opens an ImagePopout and shares it to all players |
| `execute-macro` | `macroName` | Runs a Foundry macro by name |
| `roll` | `formula` | Rolls dice via `new Roll(formula)` and posts the result |
| `activate-scene` | `sceneName` | Activates a scene by name |
| `send-chat` | `message` | Posts an in-character chat message |
| `eval` | `code` | Runs arbitrary JavaScript (GM trust only) |

Adding a command: call `registerCommand(name, handler)` in `scripts/bridge.js`. The handler receives the params
object and may call `sendEvent(...)` to push a `peer-event` back to the hub.

## Installing it

Zip `module.json` and `scripts/` inside a folder named `gm-hub-bridge` and install that zip in Foundry (on Forge,
through its module import). The module has no manifest link yet, so Foundry's own updater doesn't see new
versions.

It replaces the module published as `ktp-foundry-bridge`: uninstall that one first.

## Setting (in Foundry)

**gm-hub WebSocket URL**: where the hub is, by default `ws://localhost:3001/ws`. It is saved per world, under the
module's ID.

## Things to know

- Only GM clients connect to the hub.
- `globalThis.ktpBridge` (and `globalThis.gmHubBridge`, the same object) is there for macros: `registerCommand`,
  `sendEvent`, `reconnect`, `.connected`.
- Reconnecting is automatic, backing off from 1 s to 30 s.

The messages it exchanges with the hub are in [docs/protocol.md](../docs/protocol.md).

# gm-hub

The GM's hub for a streamed tabletop session, and the Foundry VTT module that connects Foundry to it. Private.

| Folder | What it is |
| --- | --- |
| [`hub/`](hub/) | The hub: a Bun server that holds the live session state and serves an OBS overlay and a GM panel. Every panel action is also a REST endpoint |
| [`foundry-bridge/`](foundry-bridge/) | GM Hub Bridge, the Foundry VTT module (ID `gm-hub-bridge`) that connects Foundry to the hub, so the GM panel can drive Foundry |

**The hub has no authentication and listens on every network interface. Run it only on a network you trust**; the
detail is in [docs/security.md](docs/security.md).

Each folder has its own `README.md` (what is in it and how to run it) and `CHANGELOG.md`. How the repo works and
the rules for changing it: [AGENTS.md](AGENTS.md). What is built: [docs/design.md](docs/design.md); the protocol the
two halves speak, and the hub's HTTP API: [docs/protocol.md](docs/protocol.md).

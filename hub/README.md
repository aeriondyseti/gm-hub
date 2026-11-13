# hub

The GM hub: a Bun server that holds the live session state and serves an OBS overlay and
a GM panel. Every panel action is also a REST endpoint, and the hub drives Foundry VTT through the Foundry bridge
in [`../foundry-bridge/`](../foundry-bridge/).

**It has no authentication and listens on every network interface. Run it only on a network you trust**; the detail
is in [docs/security.md](../docs/security.md).

| Path | What it is |
| --- | --- |
| [`server.js`](server.js) | The server: REST API, WebSocket peer bus, Kenku FM remote |
| [`openapi.js`](openapi.js) | The OpenAPI description of the REST API |
| [`clients/overlay.html`](clients/overlay.html) | The overlay, a read-only view for OBS, served at `/overlay` |
| [`clients/gm.html`](clients/gm.html) | The GM panel, served at `/gm` |
| [`data/`](data/) | The session state, presets and macros |
| [`test/`](test/) | Tests of who may reach the hub |
| [`CHANGELOG.md`](CHANGELOG.md) | What has changed |

## Running it

Needs [Bun](https://bun.sh). From this folder:

```
bun run server.js
```

Then open `/gm` and `/overlay` on the hub's port, which is in [docs/security.md](../docs/security.md) with the
settings that widen who may reach it. There is no build step: edit `server.js` and restart, or edit a page in
`clients/` and refresh.

Tests: `npm test` (Node's test runner; needs Bun on the PATH).

More: [docs/protocol.md](../docs/protocol.md) (the WebSocket protocol and HTTP API),
[docs/design.md](../docs/design.md) (what is built, and the hub's terms in its glossary).

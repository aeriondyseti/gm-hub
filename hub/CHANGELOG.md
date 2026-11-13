# Changelog

All notable changes to the hub will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are tagged `hub-vX.Y.Z`.

## [Unreleased]

### Added

- The hub: a Bun WebSocket server and browser pages (an OBS overlay, a control page and a remote) for compositing
  session state onto a Discord video feed through OBS, with scene banners, NPC nameplates, mood vignettes and a lore
  feed, bridged to Foundry VTT through ktp-foundry-bridge (aee43ef, 2026-06-04, as ktp-overlay).
- Named peers: a `peers` registry and the generalized `peer-command`, `peer-event` and `peer-status` messages
  (protocol v1.4); any tool joins by identifying with a name (d928a2c, 2026-06-04).
- The GM panel (`clients/gm.html`): one narrow column for a big-screen TV with a live preview of the overlay and the
  OBS camera toggle, macros, mood, scene, NPC, the lore queue and feed, Kenku FM, Foundry buttons, chat and eval, in
  collapsible sections, with text scaling for viewing distance; `/`, `/gm`, `/control` and `/remote` serve it, and
  `PORT` overrides port 3001 (2edf3e9, 2026-10-15).
- A REST API for every GM-panel action, described as OpenAPI 3.1 at `/api/openapi.json` with an index at `/api`:
  status, mood, session, scene and NPC show and hide, the lore feed and queue, presets, macros (now defined in
  `data/macros.json` and run by the hub), Kenku FM audio, and Foundry commands that wait for the bridge's reply;
  `KENKU_URL` sets Kenku FM's address; preset and queue changes broadcast `presets-update` (71402c1, 2026-10-15).

### Changed

- Renamed from ktp-overlay to ktp-hub, a session-state hub that also renders an overlay; the browser pages moved
  from `public/` to `clients/` (d928a2c).
- `/api/foundry` became `/api/peers/:name/command`, with replies matched by `requestId` (d928a2c).
- The GM panel replaces the separate control and remote pages and drops the old Foundry REST relay settings:
  Foundry goes through the bridge peer (2edf3e9).
- The GM panel uses the REST API instead of raw state merges, WebSocket peer commands and the Kenku passthrough.
  Saving a preset under an existing name updates it instead of adding a duplicate, and NPC portraits are requested
  only while the Foundry bridge is up (71402c1).
- The hub is in the gm-hub repository as `hub/`, beside its Foundry bridge, and is named the hub (it was ktp-hub).
  Versions follow semver from its first release, `hub-v0.1.0`; the `1.0.0` in `package.json` was never a release.

### Removed

- The hexploration peer from the docs, after that integration left ktp-foundry-bridge in its v1.7.0 (a847bc8,
  PR #1, 2026-10-25).

### Fixed

- Concurrent commands to the same peer no longer overwrite each other's HTTP replies: each resolves by its own
  `requestId` (d928a2c).
- The mood list matches the overlay's: the remote's triumphant and eerie moods silently fell back to neutral
  (2edf3e9).
- The OBS camera preview no longer fails with a blank "Camera failed:" error: it asks for camera permission first,
  then picks the OBS Virtual Camera by label, and common failures get clear messages (47fb7a9, 2026-10-15).
- Kenku FM playlist buttons switch playlists instead of only resuming playback (71402c1).

### Security

- Other sites' pages can no longer drive the hub through a browser. Until now any web page open in a browser that
  could reach the hub could send it commands, `eval` in Foundry included, even with the hub on localhost: it took
  cross-site POSTs and checked no `Origin` on the WebSocket. Now every request other than GET or HEAD, and every
  WebSocket upgrade, is refused with 403 (and logged) when its `Origin` is neither the hub's own nor one in the new
  `ALLOWED_ORIGINS` setting, which defaults to Foundry's (`http://localhost:30000`, `http://127.0.0.1:30000`), where
  the bridge connects from. `Origin: null` is refused; a request with no `Origin` (curl, a script) still passes.
- Against DNS rebinding, every request must name the hub in its `Host`: `localhost`, `127.0.0.1` or `[::1]` on the
  hub's port, or a name in the new `ALLOWED_HOSTS` setting; anything else gets 421. Opening the hub by any other
  name (the machine's LAN name or address, a Tailscale name) now needs that name in `ALLOWED_HOSTS`, and a page
  served over `tailscale serve` also needs its `https://` origin in `ALLOWED_ORIGINS`.

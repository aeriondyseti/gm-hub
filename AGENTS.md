# gm-hub

## What this is

Kevin's GM hub for streamed tabletop sessions, with its Foundry bridge: a Bun server that holds the live session
state and serves an OBS overlay and a GM panel, and the Foundry VTT module that connects Foundry to it. Two
components, each versioned on its own. The hub has not been released; the bridge was released up to 1.7.0 from a
repository of its own, as ktp-foundry-bridge. The full picture is in `docs/design.md`.

**Warning: the hub has an open security problem.** It has no authentication and listens on every network
interface, so any program that can reach its port can drive it, `eval` in the GM's Foundry browser included. Run it
only on a network Kevin trusts; the rule and the debt item are below.

## Where things are

```
hub/               the hub: Bun server (REST API, WebSocket peer bus), clients/ (OBS overlay, GM panel), data/, test/
foundry-bridge/    GM Hub Bridge, the Foundry VTT module: module.json and scripts/bridge.js
plan/plan.md       work that comes and goes (the `planning` skill)
docs/              what is in force or true now: decisions.md, design.md (with the glossary), protocol.md, security.md
<component>/README.md      what is in the component's folder and how to run it
<component>/CHANGELOG.md   what was done, one per component, [Unreleased] first; none at the root
```

The two components are `hub` and `foundry-bridge`, with tags `<component>-vX.Y.Z`. `docs/protocol.md` holds the
hub's WebSocket peer protocol and HTTP API; `docs/security.md` holds what the hub listens on and what it exposes.

## Commands

The full check (needs no keys, model calls, GPUs, outside services or live sessions; the only servers it starts are
the hub's tests' own throwaway hubs, each a copy in a temporary folder on a free port):

```
npm test --prefix hub
bun X:\Development\scripts\docs-check.ts
```

The hub's tests are in `hub/test/` (Node's test runner, no dependencies; they need Bun on the PATH, which runs each
hub under test). The bridge has no tests and no build.

Running things (by hand, at the table; it starts a server, so an agent runs it only when Kevin asks):

```
bun run hub/server.js        the hub (or npm start in hub/); the PORT variable runs a second copy;
                             ALLOWED_ORIGINS and ALLOWED_HOSTS widen who may reach it (rule below)
```

Releases (one component at a time; only on Kevin's word):

```
bun X:\Development\scripts\release.ts --component <component> --dry-run
bun X:\Development\scripts\release.ts --component hub --version-file hub/package.json [--bump minor]
bun X:\Development\scripts\release.ts --component foundry-bridge --version-file foundry-bridge/module.json
```

`hub/package.json` is the hub's version file and `foundry-bridge/module.json` the bridge's; each goes with every
release of its component. The hub's first release is 0.1.0 (`--bump minor`).

## Rules for working here

- The hub is general: nothing in how it works is specific to one campaign. Campaign content is data
  (`hub/data/`), not code.
- Player-facing views never show GM-only information: the hub's overlay.
- A page saves its state as it goes and survives a reload. A change that loses saved state (a new storage key, a
  changed saved format) is breaking, and its changelog line says so.
- A change writes its changelog lines under `[Unreleased]` in the `CHANGELOG.md` of each component it touched.
- A change to the peer protocol changes both halves and `docs/protocol.md` together.

### hub

- **Open security debt, not fixed:** the hub still has no authentication and listens on every network interface,
  and a program that isn't a browser page passes both checks below, so anything that can reach the port can read and
  change the session and run `eval` in the GM's Foundry browser through the bridge (`network-exposure` in
  `plan/plan.md`; the detail is in `docs/security.md`). Until it is fixed, run the hub only on a network Kevin
  trusts. Never `tailscale funnel`: it puts the hub on the public internet.
- **Every new endpoint is a `route(...)` in `hub/server.js` and an entry in `hub/openapi.js`**; the GM panel uses
  the same endpoints, so anything it does stays scriptable.
- The hub checks the `Host` of every request (421) and the `Origin` of every request but GET and HEAD and of every
  `/ws` upgrade (403), so another site's page in a browser can't drive it (`docs/security.md`). Keep both checks in
  front of every route, and keep `hub/test/` passing. The allowed lists come from two environment variables,
  `ALLOWED_ORIGINS` and `ALLOWED_HOSTS`; their defaults and the setup for a phone or tablet over Tailscale are in
  `docs/security.md`.
- State is opaque to peers: only browser clients read `data/state.json`; peers exchange `peer-*` messages and never
  see the hub's state directly.
- `requestId` is required on any command that expects a response. The hub keys pending HTTP requests by it and
  peers echo it back in their `peer-event`; without it an HTTP forward always times out at 10 s.
- Bun-specific APIs (`import.meta.dir`, `Bun.serve`, `server.upgrade()`): not Node-compatible without a runtime swap.
- No build step: edit `server.js` and restart; edit a `clients/*.html` page and refresh.

### foundry-bridge

- The module's ID is `gm-hub-bridge`. Foundry keys a world's settings to it, so changing it loses the saved
  WebSocket address in every world that has the module.
- Only GM clients connect to the hub: the hub keys peers by name, and the last connection takes the `foundry`
  slot, so a player's client must never connect.
- `globalThis.ktpBridge` is the name macros use for the bridge; `globalThis.gmHubBridge` is the same object. Keep
  both.
- A new command is a `registerCommand(name, handler)` in `scripts/bridge.js`.

## Git

- Trunk: `main`; remote `origin` is GitHub `aeriondyseti/ktp-hub`, to be renamed gm-hub (`plan/plan.md`). The
  repository is private. A branch is named by the piece of work it holds; the branch is the claim.
- The checkout is `X:\Development\tabletop\gm-hub`, beside Kevin's other tabletop repositories. A branch's worktree
  is a sibling folder, `..\gm-hub.<name>`; never a worktree inside the checkout (`.claude/worktrees/` is gitignored
  in case a harness does).
- Integration: a local `git merge --no-ff`, or a PR merged with a merge commit; never squash. The merge commit's
  body carries the review. One merge into the trunk at a time; the full check runs on the trunk after the merge.
- Commits: a Conventional Commits subject (`feat:`, `fix:`, `docs:`, `chore:` …), scoped to the component when
  there is one (`fix(hub): …`).
- Versions: semver per component, tagged `<component>-vX.Y.Z`; no unprefixed version tags. The hub's first release
  is 0.1.0 (`docs/decisions.md`). A release, its version and its tag are cut only on Kevin's word, by the release
  command.
- Never push, release, tag or delete a branch without Kevin's word.

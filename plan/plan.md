# Plan

Work that comes and goes. An item leaves when it finishes; each component's `CHANGELOG.md` says what was done.

## Now

Nothing is being built.

## Next

**decide-the-parked-branches.** Kevin: two branches hold hub work that is not on `main`: `wsl-salvage-2026-10` on
GitHub (`2d04b95`, 2026-10-22: work salvaged from the WSL copy, based on the June protocol commit: overlay tweaks,
preset and state data, and two scripts, audit-party.js and ktp-eval.mjs) and the local `wip/pre-reorg-changes`
(`17eb547`: the uncommitted changes found in the checkout on 2026-11-12, to the overlay page, the presets and the
state file, and the same two scripts). Done when each is merged or dropped.

**remove-the-bridge-checkout.** Kevin: remove `X:\Development\ktp-foundry-bridge`, the checkout of the bridge's old
repository, now archived on GitHub; its history up to v1.7.0 is in this repository. Done when it is gone.

**install-the-bridge-on-forge.** Kevin: on Forge, uninstall ktp-foundry-bridge, install the bridge from its manifest URL,
https://github.com/aeriondyseti/gm-hub/releases/latest/download/module.json, and enter the hub's WebSocket
address again. Done when the GM panel drives
Foundry on Forge through the module under its new ID.

## Ideas

**console.** Move the GM panel out of the hub into its own component. The hub's notes said from the start that the
GM's input surface (then the control and remote pages, since 2026-10-15 the GM panel, `hub/clients/gm.html`) "may
eventually move to a sibling `ktp-console/` repo". Here that would be its own folder and component beside `hub/`,
talking to the hub only through its REST API and WebSocket, as every other client does. The overlay, the hub's
projection, would stay with the hub. Nothing says yet what would make it worth doing. Raised by Kevin, 2026-06-04.

**campaign-data-outside-the-hub.** `hub/data/presets.json` and `macros.json` hold one campaign's content (Keys to
Perfection) inside a hub that is otherwise general. The hub could read its data folder from a setting, so a
campaign's presets live with the campaign. Worth doing when the hub is used for a second campaign. Raised
2026-11-12.

## Debt

**network-exposure.** The hub is open to anything on the network that isn't a browser page. Where:
`hub/server.js`. Source: Sable's review 0.4.106 M2 (her ADR-0512). Raised 2026-10-16. Worth fixing: before the hub
runs on a network Kevin doesn't trust. The hub listens on every network interface (`Bun.serve` with no `hostname`)
and has no authentication. Its `Host` and `Origin` checks (`docs/security.md`) keep other sites' pages in a
browser out, but a program that can reach port 3001 sets its own `Host` and sends no `Origin`, and passes both.
Such a program can run `eval` in the GM's browser through the Foundry bridge, and read what that browser reads,
GM-only content included, because every peer reply is broadcast to every socket. Any socket can also identify as
`foundry` and take the bridge's place, so the next command meant for Foundry goes to it. What is left of the fix
recorded with the finding: bind `127.0.0.1`, and answer a command's reply only to the caller that sent it, not to
every socket. Binding `127.0.0.1` cuts off nothing Kevin uses today: his overlay and GM screens run on the hub's
machine, and `tailscale serve` reaches the hub through loopback. Only a device opening the hub straight by its LAN
address or name (`ALLOWED_HOSTS`) would lose it.

**host-name-matching.** The hub's Host and Origin checks disagree on some spellings of the same name. Where:
`hub/server.js` (`parseHost`, `originOf`, `hostAllowed`). Source: the review of 2026-11-12. Worth fixing: when a
name the hub should accept is refused, or with the next change to the two checks. Each case refuses a request it
should allow; none lets one in. A Host with a trailing dot (`localhost.:3001`) passes the Host check, but the
page's Origin keeps the dot and isn't among the hub's own origins, so the GM panel loads and then every change and
the WebSocket get 403. An IPv6 address in `ALLOWED_HOSTS` written in a longer form than browsers send
(`[FD7A:115C:A1E0:0:0:0:0:1]`) never matches the browser's Host, so every request gets 421, with no warning as the
hub starts. A loopback name listed in `ALLOWED_HOSTS` is still tied to the hub's port, though `docs/security.md`
says a name in `ALLOWED_HOSTS` is accepted on any port. A fix would normalise a name once, the same way, for both
checks, and either let a listed loopback name through on any port or say in `docs/security.md` that the three
loopback names are always tied to the hub's port.

**live-state-in-tracked-files.** The hub writes live session state into tracked files. Where: `hub/server.js`.
Raised 2026-11-04. Worth fixing: before the hub's first release, since the release command refuses a dirty tree.
The hub rewrites `hub/data/state.json` (and `data/presets.json`, the library the GM edits live) as a session runs.
Both are tracked, so running the hub from the checkout leaves the tree dirty, and a commit can sweep a session's
state in by accident. A fix would keep a default or empty file tracked and write live state to an ignored file
beside it. It waits because it changes where the server keeps its data, which is behaviour; which files are seed
data (presets, macros) and which are only live state is Kevin's call.

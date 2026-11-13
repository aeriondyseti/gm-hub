# Decisions

The pillars: what would cost something to reverse, and why. One section per topic, holding the whole decision on
it. Anything not here is paint, and may change. Records are written only on Kevin's instruction.

## The hub's version

Status: proposed (2026-11-04)

The hub is pre-1.0, and its first tagged release is 0.1.0. Decision-maker: Kevin.

The hub's `package.json` says 1.0.0, but that is npm's default: the hub has never been tagged or released, and it has
no CI and no release command. A version of 1.0.0 or later needs a release gate (a command that tags only after the
full check passes on that commit), so the hub either gets one now or goes back to 0.x.

The options considered:

- Keep 1.0.0 and add a release gate before the next release.
- Treat the hub as pre-1.0 and start its tags at 0.1.0.

The hub is treated as pre-1.0. Its first tagged release is `hub-v0.1.0`, cut by the release command, and versions
follow semver from there. Every release of the hub passes `hub/package.json` as its version file, so the file always
holds the last release's version; the 1.0.0 it holds now is never tagged. Moving to 1.0.0 is Kevin's call, recorded
as a new decision, and needs the release gate.

Made overnight on 2026-11-03 on Kevin's delegation (each repo already past 1.0 without a release gate gets whichever
fits its state), and written down on 2026-11-04, when the hub was called ktp-hub.

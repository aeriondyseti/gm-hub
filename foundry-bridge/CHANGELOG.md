# Changelog

All notable changes to the Foundry bridge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are tagged `foundry-bridge-vX.Y.Z`. Versions up to 1.7.0 were released from the module's own repository,
as ktp-foundry-bridge, and are in its history there.

## [Unreleased]

## [2.0.0] - 2026-11-12

### Changed

- **BREAKING** The module's ID is `gm-hub-bridge` and its title GM Hub Bridge (it was `ktp-foundry-bridge`, KTP
  Hub Bridge). Foundry treats it as a new module: uninstall the old one, install this one and enter the hub's
  WebSocket address again in each world (tabletop-layout).
- The module lives in the gm-hub repository beside the hub, as `foundry-bridge/`. Its manifest URL is
  `https://github.com/aeriondyseti/gm-hub/releases/latest/download/module.json`, so Foundry's updater follows its
  releases there (tabletop-layout).
- Macros can reach the bridge as `gmHubBridge` as well as `ktpBridge` (tabletop-layout).

[Unreleased]: https://github.com/aeriondyseti/gm-hub/compare/foundry-bridge-v2.0.0...HEAD
[2.0.0]: https://github.com/aeriondyseti/gm-hub/releases/tag/foundry-bridge-v2.0.0

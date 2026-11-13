# Changelog

All notable changes to the Foundry bridge will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are tagged `foundry-bridge-vX.Y.Z`. Versions up to 1.7.0 were released from the module's own repository,
as ktp-foundry-bridge, and are in its history there.

## [Unreleased]

### Changed

- **BREAKING** The module's ID is `gm-hub-bridge` and its title GM Hub Bridge (it was `ktp-foundry-bridge`, KTP
  Hub Bridge). Foundry treats it as a new module: uninstall the old one, install this one and enter the hub's
  WebSocket address again in each world (tabletop-layout).
- The module lives in the gm-hub repository beside the hub, as `foundry-bridge/`, and has no manifest or download
  link: it is installed from a zip (tabletop-layout).
- Macros can reach the bridge as `gmHubBridge` as well as `ktpBridge` (tabletop-layout).

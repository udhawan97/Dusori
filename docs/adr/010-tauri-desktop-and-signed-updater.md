# ADR-010: Tauri desktop shell and explicit signed updates

**Status:** accepted · **Date:** 2026-08-04

## Decision

Ship the existing Svelte application in a Tauri 2 desktop shell for macOS Apple silicon and Windows x64. Intel Macs are intentionally unsupported. Bundle a target-native Node.js 24 runtime plus a compiled companion entry as a sidecar resource. Keep workspace logic in shared TypeScript packages; the Rust shell owns process launch, update verification, and validated IPC only.

Desktop updates use Tauri’s updater with a fixed GitHub Releases endpoint:

```text
https://github.com/udhawan97/Dusori/releases/latest/download/latest.json
```

Check, download, install, and restart remain separate commands. An opt-in may automate checks and downloads, never installation or restart. Unsaved work blocks install and relaunch.

Release builds require private updater signing material from the protected GitHub `release` environment and inject only the public key into a release-only configuration overlay. The checked-in configuration stays safely unprovisioned. A matching `v<version>` tag builds both targets; publication is blocked until signatures, assets, `latest.json`, and `SHA256SUMS.txt` are verified.

## Why

- The web app, core, and storage contracts remain reusable and open source.
- Tauri supplies a small native security boundary and a maintained signature-verifying updater.
- Bundling a target-native runtime avoids requiring Node.js from ordinary desktop users.
- Explicit restart semantics preserve user control and make unsaved-work handling testable.

## Consequences

- Desktop builds are platform-specific and release CI becomes a required proof lane.
- Updater signing keys require durable offline recovery and protected CI storage.
- v0.12.2 installers are not Apple-notarized or Microsoft code-signed, so first-launch OS warnings remain. Updater signatures do not replace OS trust signing.
- A bad release feed must be withdrawn and replaced with a forward fix; the app does not silently downgrade.

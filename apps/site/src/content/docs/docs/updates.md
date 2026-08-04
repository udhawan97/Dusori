---
title: Updates and recovery
description: Check, download, verify, install, relaunch, or recover the Dusori desktop app.
---

The browser build updates when the hosted site refreshes. The desktop app uses a signed update feed published with GitHub Releases.

:::caution[One-time manual desktop repair]
Every v0.12.0 or v0.12.1 desktop build needs one manual v0.12.3 install. Both affected versions open to a launch-time 404, so Settings is inaccessible. The Intel v0.12.0 Mac build also cannot safely select the Apple silicon feed. Your workspace is stored separately and remains in place; normal in-app updates work from v0.12.2 onward.
:::

## Manual update

1. Open **Settings → App updates**.
2. Choose **Check now**. Dusori requests `releases/latest/download/latest.json` from the project’s GitHub repository.
3. Review the offered version and release notes.
4. Choose **Download update**. The updater downloads the platform-specific artifact and verifies its cryptographic signature.
5. Finish or save current work.
6. Choose **Install and restart**. Dusori installs the already verified artifact and relaunches the app.

Checking, downloading, installing, and relaunching are separate states. A download never grants permission to install. An install never starts while Dusori reports unsaved work.

## Automatic checks and downloads

Enable **Automatically check and download** to check at application startup and prepare an available update even when you open straight into any topic view. This preference is stored locally.

The option does **not** authorize installation or restart. Every update still waits for **Install and restart**.

## What is verified

- Release builds contain only the updater public key.
- Private signing material is held by the protected GitHub release environment.
- `latest.json` maps Apple silicon and Windows x64 to a version-tagged asset and its signature.
- The app enforces a 512 MiB download limit.
- If the offered version changes after download, installation is refused and you must check and download again.

The OS installer itself is not Apple-notarized or Microsoft code-signed in v0.12.3. That is why Gatekeeper or SmartScreen may warn on first install even though the in-app updater has its own valid signature.

## Recovery

If checking fails:

- confirm the device can reach GitHub Releases;
- keep using the installed version; no workspace migration is attempted by a check;
- retry later or inspect the [release page](https://github.com/udhawan97/Dusori/releases/latest).

If downloading or signature verification fails:

- do not bypass the error;
- choose **Later** to discard the pending in-memory download, or check again;
- download the platform installer from the release page and compare it with `SHA256SUMS.txt`.

If installation or relaunch fails:

1. Leave the workspace files in place; they are separate from the application bundle.
2. Reopen the currently installed app if it still exists.
3. Download the matching platform installer from the release page.
4. Verify its SHA-256 checksum.
5. Reinstall. Export the workspace ZIP before any storage troubleshooting.

If a release feed is withdrawn, automatic checks stop offering that asset. Existing installations and workspace files remain usable. Dusori does not silently downgrade; use a prior installer from its versioned release page only when the release notes explicitly direct it, and verify its signature or published checksum.

# Changelog

All notable changes to the Control4 desktop app will be documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions track [SemVer](https://semver.org/).

## [0.4.0] — 2026-09-26

Security hardening, live updates that actually work, and far less load on
your Director.

### Security

- **Director certificate pinning** — the app remembers your Director's
  certificate the first time it connects and refuses to talk to anything
  else on that IP. If you replace the controller, open Settings and save
  again to trust the new one.
- **Password encrypted at rest** — stored with Windows DPAPI instead of
  plain JSON (existing settings are converted automatically on first
  launch). The settings screen no longer shows the saved password; leave
  the field blank to keep it.
- Settings are validated before they're saved, so a typo can't replace a
  working login.
- Only `https:` links open in the browser.

### Fixed

- **Real-time updates now work.** Earlier versions advertised push
  updates, but the connection to the Director's event feed never came up
  (it used an incompatible Socket.IO version and the wrong channel). Light,
  lock, blind, climate, security and AV changes now show up within a
  second.
- Token refreshes no longer drop the event feed after ~24 hours.

### Faster

- A full refresh now takes **1 request instead of 75** (about 60 ms
  instead of 2.2 s on a typical house): the device list is cached and all
  light levels are read in one batched call.
- Screens refresh when something changes instead of every 5 seconds, with
  a slow 30 s safety poll. AV views refresh on room/AV events with a 15 s
  fallback instead of polling every 3 s.

## [0.1.1] — 2026-04-21

First public release of the Control4 desktop app. Standalone Windows
installer that talks directly to your Director over the LAN — no dealer, no
cloud round-trips for commands.

### Highlights

- **Rooms** organized by floor, with capability-aware filtering
  (audio-only, video-only, both, matrix-audio)
- **Lights** — dimmer/switch grid with level sliders and an "all off" per room
- **Climate** — heat/cool setpoints, HVAC mode, per-thermostat
- **Audio/Video** — matrix-aware source routing (SiriusXM, Pandora, Spotify
  Connect, ShairBridge AirPlay, DVR, …), cross-service browse per source,
  room volume/mute/transport controls
- Frameless window with native Windows min/max/close controls
- **Auto-update** via GitHub Releases — 0.1.2+ will download in the
  background; this is the last version you'll install by hand

### Install

Download `Control4-Setup-0.1.1.exe` from the release assets. Windows
SmartScreen will warn on first launch ("Windows protected your PC" →
More info → Run anyway). Per-user install, no admin required.

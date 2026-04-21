# Changelog

All notable changes to the Control4 desktop app will be documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions track [SemVer](https://semver.org/).

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

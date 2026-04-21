# Control4 0.2.0 — Event-Driven Real-Time Updates

**Release Date:** April 21, 2026

## Overview

Control4 0.2.0 replaces fixed-interval polling with real-time WebSocket updates powered by the Control4 Director's native push notifications. Device state changes now appear instantly instead of waiting up to 10 seconds for the next poll.

## What's New

### ✨ Real-Time WebSocket Updates
- **Instant device state reflection** — Security panel states, lock positions, blind levels, and climate readings update within milliseconds of changing on the system
- **Socket.IO v4 integration** — Connects to Control4 Director's native `/api/v1/items/datatoui` WebSocket namespace for true push-based updates
- **Zero-polling fallback** — When nothing changes, zero API calls are made. Previously: Security polled every 3s, Locks/Blinds every 5s, Climate every 10s

### 🚀 Performance Improvements
- **Reduced API load** — No more fixed-interval REST calls for device state
- **Faster UI responsiveness** — State updates arrive in ~1 second instead of 3-10 seconds
- **Lower bandwidth usage** — Only transmits updates when state actually changes
- **Optimistic updates** — Lock toggles, blind adjustments, and thermostat nudges feel instant even before server confirmation

### 🔧 Technical Implementation
- New `Control4WebSocket` class for Socket.IO v4 handshake and subscription management
- React hook `useItemStates` replaces per-component polling in SecurityPanel, LocksPanel, BlindsPanel, and ClimatePanel
- IPC push channel `events:itemChanged` bridges main process events to renderer
- Automatic reconnection when director token refreshes

## Device Panels Updated

| Panel | Previous Polling | New Behavior |
|-------|------------------|--------------|
| **Security** | Every 3 seconds | Instant push updates |
| **Locks** | Every 5 seconds | Instant push updates |
| **Blinds** | Every 5 seconds | Instant push updates |
| **Climate** | Every 10 seconds | Instant push updates |

## Installation & Requirements

- **Node.js:** 18+
- **Electron:** 33+
- **New dependency:** `socket.io-client@4` (already included)

## Known Limitations

- WebSocket connection requires active Control4 Director on LAN
- PIN entry for disarm still uses inline input (no modal popup)
- Alarm "Night" mode behavior depends on your Control4 programming

## Testing

1. Launch the app: `npm run dev`
2. Change a device physically or via Control4 Navigator
3. Watch the app update within ~1 second
4. Check DevTools Network tab — no `/variables` requests on a timer

## Commits

- **Replace polling with event-driven WebSocket updates** — Core implementation
- **Filter out partition sub-items from security panel listing** — Security panel simplification (0.1.2)

## Upgrade Notes

No breaking changes. Existing configurations work without modification. The app automatically starts the WebSocket listener on startup and after configuration changes.

## Feedback

Issues or suggestions? Open an issue on [GitHub](https://github.com/bkwagner/Control4/issues).

---

**Built with:** Electron, React, TypeScript, Vite, Tailwind CSS  
**Control4 Integration:** Direct REST + WebSocket to Control4 Director

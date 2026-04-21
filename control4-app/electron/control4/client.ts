// High-level Control4 client. Owns the director token lifecycle and exposes
// the same operations the UI used to call over HTTP. Methods correspond
// 1:1 to what the Electron preload bridge exposes to the renderer.

import type { Settings } from "./config";
import type { DirectorBinding, DirectorItem, DirectorVariable } from "./director";
import { Director } from "./director";
import {
  getAccountBearerToken,
  getAccountControllers,
  getDirectorBearerToken,
} from "./auth";
import type { DirectorToken } from "./auth";

// Binding-class values Control4 actually emits on source Outputs. These
// are the structural signal that a tile in `audio_video` carries real A/V
// somewhere (vs. being an admin/DSP/internal subdevice).
//
// Class names vary slightly across device protocols; keep this list
// permissive by using the bare names Director returns rather than the
// suffixed variants some documentation uses (`HDMI`, not `HDMI_OUT`).
const VIDEO_OUTPUT_CLASSES = new Set([
  "HDMI",
  "COMPONENT",
  "SVIDEO",
  "COMPOSITE",
  "DVI",
  "DISPLAYPORT",
  "VIDEO",
]);
const AUDIO_OUTPUT_CLASSES = new Set([
  "STEREO",
  "DIGITAL_COAX",
  "DIGITAL_OPTICAL",
  "COAX",
  "OPTICAL",
  "ANALOG_AUDIO",
  "AUDIO",
  "DIGITAL_AUDIO",
  // Distributed-audio services (SiriusXM, Pandora, My Music, ShairBridge
  // AirPlay endpoints) all ride this class to the shared digital-audio hub.
  "DIGITAL_AUDIO_SERVER",
]);

// Proxy-based prefilter for candidate sources. The structural analyzer
// below decides which candidates are actually surfaceable; anything not
// in this set is never a user-facing source tile.
const CANDIDATE_SOURCE_PROXIES = new Set([
  "media_service",
  "media_player",
  "tv",
  "cable",
  "cd",
  "dvd",
]);

function looksLikeCandidateSource(item: DirectorItem): boolean {
  return CANDIDATE_SOURCE_PROXIES.has(String(item.proxy ?? ""));
}

// Hub/matrix target proxies — if a source's visible Output binding
// connects to one of these, the source is routable across the matrix
// (reaches every room wired to the hub).
const AUDIO_MATRIX_TARGET_PROXIES = new Set([
  "amplifier",
  "control4_digitalaudio", // Control4's distributed-audio hub (DMS)
]);
const VIDEO_MATRIX_TARGET_PROXIES = new Set(["avswitch", "av_switch"]);

// Proxy used by the Digital Media Server device whose home room acts as
// the virtual "Channels" hub. Aggregator tiles (Stations, My Movies, …)
// rooted in this room ride the matrix; aggregators rooted in real rooms
// are scoped to that room.
const HUB_DEVICE_PROXIES = new Set([
  "control4_digitalaudio",
  "media_server",
]);

export interface RoomDTO {
  id: number;
  name: string;
  floorName: string | null;
  floorId: number | null;
  hasAv: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
  // True if at least one AUDIO_SELECTION input is wired to a non-TV device
  // (amp / receiver / matrix zone). Rooms whose only audio path is a TV
  // speaker can't receive the distributed-audio hub's services like
  // SiriusXM or Pandora, even if the TV itself has absolute volume.
  hasMatrixAudio: boolean;
}
export interface LightDTO {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
  floorName: string | null;
  level: number | null;
  state: number | null;
  dimmable: boolean;
}
export type SourceKind = "audio" | "video" | "both";

export interface MediaSourceDTO {
  id: number;
  name: string;
  proxy: string | null;
  roomName: string | null;
  // Rooms this source is directly wired into — derived from its visible
  // Output connections' roomId. Sources without matrix flags show up only
  // in these rooms; sources with matrix flags also show up anywhere the
  // room's matrix endpoints lead.
  roomIds: number[];
  kind: SourceKind;
  // True if a visible audio Output connects to an amp / media-server hub
  // (or, for aggregators living in the hub room, true by inference).
  // Rooms whose `hasMatrixAudio` is set will show this source.
  matrixAudio: boolean;
  // Same idea for video matrices (AV switcher fan-out). Rare on typical
  // residential installs.
  matrixVideo: boolean;
  // Aggregator tiles (Stations, My Movies, …) have no routable outputs —
  // in Navigator they open a cross-service browse view keyed on media
  // kind rather than selecting a specific device. Browse uses this.
  aggregator: boolean;
}
export type RoomAvMode = "off" | "audio" | "video";

export interface RoomAvStateDTO {
  room_id: number;
  is_on: boolean;
  volume: number;
  muted: boolean;
  mode: RoomAvMode;
  audio_source_id: number | null;
  video_source_id: number | null;
}
export interface ClimateDeviceDTO {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
}

export interface MediaBrowseItemDTO {
  id: number;
  label: string;
  img: string | null;
}

export interface MediaBrowseGroupDTO {
  kind: string;
  label: string;
  isVideo: boolean;
  items: MediaBrowseItemDTO[];
}

interface DirectorCommand {
  command?: string;
  label?: string;
  params?: Array<{
    name?: string;
    valueSrc?: { method?: string; path?: string };
    valueField?: string;
    valueDisplay?: string;
  }>;
}

// Friendlier section headers than Control4's own "Broadcast Audio" etc.
const KIND_LABELS: Record<string, string> = {
  BROADCAST_AUDIO: "Channels",
  BROADCAST_VIDEO: "Channels",
  PLAYLIST: "Playlists",
  ALBUM: "Albums",
  MOVIE: "Movies",
  SONG: "Songs",
  STATION: "Stations",
  GENRE: "Genres",
};

function kindLabel(kind: string): string {
  return (
    KIND_LABELS[kind] ??
    kind
      .toLowerCase()
      .split("_")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}

// Render a Control4 `valueDisplay` template (e.g. `{title} - {artist}`) against
// a raw browse row. Missing fields collapse, stripping dangling separators.
function renderTemplate(
  template: string,
  row: Record<string, unknown>,
): string {
  const out = template.replace(/\{(\w+)\}/g, (_m, key) => {
    const v = row[key];
    return v == null ? "" : String(v);
  });
  return out.replace(/\s*-\s*$/, "").replace(/^\s*-\s*/, "").trim();
}

function slimRoom(
  it: DirectorItem,
  caps: { hasAudio: boolean; hasVideo: boolean; hasMatrixAudio: boolean },
): RoomDTO {
  return {
    id: it.id,
    name: String(it.name ?? ""),
    floorName: (it.floorName as string | null) ?? null,
    floorId: (it.floorId as number | null) ?? null,
    hasAv: caps.hasAudio || caps.hasVideo,
    hasAudio: caps.hasAudio,
    hasVideo: caps.hasVideo,
    hasMatrixAudio: caps.hasMatrixAudio,
  };
}

// Control4's project tree returns both the physical hardware device and the
// user-facing virtual proxy that wraps it (e.g. "Wireless Dimmer" + "Bay
// Window Light"). Keep only the leaves — items that aren't the parent of any
// other item in the same set.
function keepLeaves<T extends DirectorItem>(items: T[]): T[] {
  const parentIds = new Set<number>();
  for (const it of items) {
    const pid = it.parentId;
    if (typeof pid === "number") parentIds.add(pid);
  }
  return items.filter((it) => !parentIds.has(it.id));
}

interface SourceAnalysis {
  kind: SourceKind | null;
  roomIds: number[];
  matrixAudio: boolean;
  matrixVideo: boolean;
  aggregator: boolean;
}

// Derive routing + kind from an item's bindings. The decision tree:
//
//   1. Walk non-hidden Output bindings:
//      • `bindingClass` in AUDIO_OUTPUT_CLASSES → source carries audio
//      • `bindingClass` in VIDEO_OUTPUT_CLASSES → source carries video
//      • connection.roomId → source is directly wired into that room
//      • connection target with `amplifier` / `media_server` proxy → it
//        feeds the audio matrix; any room with `hasMatrixAudio` will hear it
//      • same logic for `av_switch` → video matrix
//
//   2. If every Output binding is hidden (or there are none at all), the
//      item is an "aggregator" tile — Stations, My Movies, etc. These have
//      no real routing; Navigator shows them in rooms that can browse the
//      matching media kind. Kind comes from the item's name (brittle but
//      the only readable signal on these tiles). Aggregators in the hub
//      room (where the media server lives) ride the matrix; aggregators
//      attached to a real room are scoped to that room.
//
//   3. Otherwise fall back to proxy-name kind guesses for items whose
//      visible bindings don't carry a recognized routing class (streaming
//      apps with only RF_MINI_APP, etc.).
function analyzeSource(
  item: DirectorItem,
  bindings: DirectorBinding[],
  proxyById: Map<number, string>,
  hubRoomId: number | null,
): SourceAnalysis {
  const roomIds = new Set<number>();
  let visibleAudio = false;
  let visibleVideo = false;
  let hasVisibleOutput = false;
  let matrixAudio = false;
  let matrixVideo = false;

  for (const b of bindings ?? []) {
    if (b.inputoutput !== "Output") continue;
    if (b.hidden) continue;
    hasVisibleOutput = true;
    const cls = b.bindingClass ?? "";
    const isAudio = AUDIO_OUTPUT_CLASSES.has(cls);
    const isVideo = VIDEO_OUTPUT_CLASSES.has(cls);
    if (isAudio) visibleAudio = true;
    if (isVideo) visibleVideo = true;

    for (const c of b.connections ?? []) {
      if (!c.id || c.id <= 0) continue;
      if (typeof c.roomId === "number" && c.roomId > 0) {
        roomIds.add(c.roomId);
      }
      const targetProxy = proxyById.get(c.id) ?? "";
      if (isAudio && AUDIO_MATRIX_TARGET_PROXIES.has(targetProxy)) {
        matrixAudio = true;
      }
      if (isVideo && VIDEO_MATRIX_TARGET_PROXIES.has(targetProxy)) {
        matrixVideo = true;
      }
    }
  }

  const aggregator = !hasVisibleOutput;
  const proxy = String(item.proxy ?? "");
  const name = String(item.name ?? "").toLowerCase();

  let kind: SourceKind | null = null;
  if (visibleAudio && visibleVideo) kind = "both";
  else if (visibleAudio) kind = "audio";
  else if (visibleVideo) kind = "video";

  if (kind === null) {
    if (proxy === "media_service") {
      kind = /movie|film|video|tv/.test(name) ? "video" : "audio";
    } else if (proxy === "tv" || proxy === "cable" || proxy === "dvd") {
      kind = "video";
    } else if (proxy === "media_player") {
      kind = "video";
    }
  }

  const itemRoomId = (item.roomId as number | null) ?? null;
  const itemRoomName = String(item.roomName ?? "");
  const itemName = String(item.name ?? "");

  if (aggregator) {
    // Aggregator is universal only if it lives in the hub room (alongside
    // the DMS). A media_service with the same shape but rooted in a real
    // room (e.g. Basement's own "Channels" tile) is local to that room.
    if (hubRoomId !== null && itemRoomId === hubRoomId) {
      if (kind === "audio" || kind === "both") matrixAudio = true;
      if (kind === "video" || kind === "both") matrixVideo = true;
    } else if (itemRoomId !== null) {
      roomIds.add(itemRoomId);
    }
  } else if (
    itemRoomId !== null &&
    itemRoomId !== hubRoomId &&
    itemName !== "" &&
    itemName === itemRoomName
  ) {
    // Room-scoped endpoint: ShairBridge AirPlay receivers are auto-named
    // after the room they advertise in. Their DAS-to-hub binding is a
    // format-conversion artifact, not a matrix route — functionally they
    // only matter to their own room. Collapse routing to the home room.
    roomIds.clear();
    roomIds.add(itemRoomId);
    matrixAudio = false;
    matrixVideo = false;
  }

  return { kind, roomIds: [...roomIds], matrixAudio, matrixVideo, aggregator };
}

function slimClimate(it: DirectorItem): ClimateDeviceDTO {
  return {
    id: it.id,
    name: String(it.name ?? ""),
    roomId: (it.roomId as number | null) ?? null,
    roomName: (it.roomName as string | null) ?? null,
  };
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export class Control4Client {
  private director: Director | null = null;
  private tokenExpiresAt = 0;
  private connectingPromise: Promise<Director> | null = null;

  constructor(private readonly settings: Settings) {}

  // Lazily (re)connect to the director when the token is missing or near
  // expiry. Callers just use `ensureDirector()` and stop worrying about it.
  private async ensureDirector(): Promise<Director> {
    if (this.director && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.director;
    }
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = this.connect().finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  private async connect(): Promise<Director> {
    if (this.director) {
      this.director.close();
      this.director = null;
    }

    const accountToken = await this.retry(() =>
      getAccountBearerToken(this.settings.username, this.settings.password),
    );
    const controllers = await this.retry(() =>
      getAccountControllers(accountToken),
    );
    const commonName =
      this.settings.controllerCommonName ??
      controllers[0]?.controllerCommonName;
    if (!commonName) {
      throw new Error("No controller found on this Control4 account.");
    }
    const token: DirectorToken = await this.retry(() =>
      getDirectorBearerToken(accountToken, commonName),
    );
    const director = new Director(this.settings.directorIp, token.token);
    this.director = director;
    this.tokenExpiresAt = token.expiresAt;
    return director;
  }

  // Cloud endpoints occasionally drop the TLS connection mid-handshake under
  // load. A short retry loop hides that from the UI.
  private async retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    let delay = 500;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const msg = String(e);
        const retriable =
          /ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR|fetch failed|socket hang up/i.test(
            msg,
          );
        if (!retriable || i === attempts - 1) throw e;
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
    throw lastErr;
  }

  async healthCheck(): Promise<{ status: string }> {
    await this.ensureDirector();
    return { status: "ok" };
  }

  async listRooms(): Promise<RoomDTO[]> {
    const director = await this.ensureDirector();
    const items = await director.getAllItems();
    const proxyById = new Map<number, string>();
    for (const it of items) {
      const proxy = it.proxy == null ? "" : String(it.proxy);
      proxyById.set(it.id, proxy);
    }
    const rooms = items.filter((it) => it.typeName === "room");
    const withAv = await Promise.all(
      rooms.map(async (r) => {
        const caps = await this.roomAvCaps(director, r.id, proxyById);
        return slimRoom(r, caps);
      }),
    );
    return withAv;
  }

  // Walk the room's Input bindings to figure out whether it has an audio
  // output (amp-backed zone) and/or video output (TV/display). Rooms may
  // have one, both, or neither; the AV tab and source filtering key off
  // these flags independently. Also flag whether the audio path goes
  // through a non-TV device (amp/receiver) — that's the signal that the
  // room can receive distributed audio services (SiriusXM, Pandora) from
  // the shared "Channels" hub. TV-speaker-only rooms can't, even if the
  // TV supports absolute volume.
  private async roomAvCaps(
    director: Director,
    roomId: number,
    proxyById: Map<number, string>,
  ): Promise<{
    hasAudio: boolean;
    hasVideo: boolean;
    hasMatrixAudio: boolean;
  }> {
    try {
      const bindings = await director.sendGet<DirectorBinding[]>(
        `/api/v1/items/${roomId}/bindings`,
      );
      let hasAudio = false;
      let hasVideo = false;
      let hasMatrixAudio = false;
      for (const b of bindings ?? []) {
        if (b.inputoutput !== "Input") continue;
        const cls = b.bindingClass ?? "";
        if (cls !== "AUDIO_SELECTION" && cls !== "VIDEO_SELECTION") continue;
        const conns = (b.connections ?? []).filter(
          (c) => c.id && c.id !== roomId,
        );
        if (conns.length === 0) continue;
        if (cls === "VIDEO_SELECTION") {
          hasVideo = true;
          continue;
        }
        hasAudio = true;
        if (hasMatrixAudio) continue;
        for (const c of conns) {
          const proxy = proxyById.get(c.id) ?? "";
          if (proxy && proxy !== "tv") {
            hasMatrixAudio = true;
            break;
          }
        }
      }
      return { hasAudio, hasVideo, hasMatrixAudio };
    } catch {
      return { hasAudio: false, hasVideo: false, hasMatrixAudio: false };
    }
  }

  async setRoomOff(roomId: number): Promise<void> {
    const director = await this.ensureDirector();
    await director.sendCommand(roomId, "ROOM_OFF");
  }

  async listLights(): Promise<LightDTO[]> {
    const director = await this.ensureDirector();
    const raw = await director.getItemsByCategory("lights");
    const items = keepLeaves(raw);
    const out: LightDTO[] = [];
    for (const it of items) {
      let level: number | null = null;
      let state: number | null = null;
      let dimmable = false;
      try {
        const vars = await director.getItemVariables(it.id);
        for (const v of vars) {
          if (v.varName === "LIGHT_LEVEL") {
            level = toInt(v.value);
            dimmable = true;
          } else if (v.varName === "LIGHT_STATE") {
            state = toInt(v.value);
          }
        }
      } catch {
        // Non-fatal: some items reject variable reads. Leave level/state null.
      }
      out.push({
        id: it.id,
        name: String(it.name ?? ""),
        roomId: (it.roomId as number | null) ?? null,
        roomName: (it.roomName as string | null) ?? null,
        floorName: (it.floorName as string | null) ?? null,
        level,
        state,
        dimmable,
      });
    }
    return out;
  }

  async setLightLevel(itemId: number, level: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const director = await this.ensureDirector();
    await director.sendCommand(itemId, "SET_LEVEL", { LEVEL: clamped });
  }

  async getItemVariables(itemId: number): Promise<DirectorVariable[]> {
    const director = await this.ensureDirector();
    return director.getItemVariables(itemId);
  }

  async listMediaSources(): Promise<MediaSourceDTO[]> {
    const director = await this.ensureDirector();
    const allItems = await director.getAllItems();
    const proxyById = new Map<number, string>();
    let hubRoomId: number | null = null;
    for (const it of allItems) {
      const proxy = String(it.proxy ?? "");
      proxyById.set(it.id, proxy);
      // The hub room is wherever the Digital Media Server lives — virtual
      // room for Control4's distributed-audio services. Services rooted
      // there are universal; aggregator tiles rooted elsewhere are local.
      if (HUB_DEVICE_PROXIES.has(proxy) && hubRoomId === null) {
        hubRoomId = (it.roomId as number | null) ?? null;
      }
    }

    const candidates = keepLeaves(allItems.filter((it) =>
      (it.categories ?? []).includes("audio_video"),
    )).filter(looksLikeCandidateSource);

    const bindingsBySource = await Promise.all(
      candidates.map((it) =>
        director
          .sendGet<DirectorBinding[]>(`/api/v1/items/${it.id}/bindings`)
          .catch(() => [] as DirectorBinding[]),
      ),
    );

    const out: MediaSourceDTO[] = [];
    candidates.forEach((it, i) => {
      const analysis = analyzeSource(it, bindingsBySource[i], proxyById, hubRoomId);
      if (analysis.kind === null) return;
      // Drop fully-orphaned sources: no kind fallback, not matrix-routable,
      // not wired to any room. Without one of those we'd have nowhere to
      // show it anyway.
      if (
        analysis.roomIds.length === 0 &&
        !analysis.matrixAudio &&
        !analysis.matrixVideo
      ) {
        return;
      }
      const proxy = String(it.proxy ?? "");
      out.push({
        id: it.id,
        name: String(it.name ?? ""),
        proxy: proxy || null,
        roomName: (it.roomName as string | null) ?? null,
        roomIds: analysis.roomIds,
        kind: analysis.kind,
        matrixAudio: analysis.matrixAudio,
        matrixVideo: analysis.matrixVideo,
        aggregator: analysis.aggregator,
      });
    });
    return out;
  }

  async getRoomAvState(roomId: number): Promise<RoomAvStateDTO> {
    const director = await this.ensureDirector();
    const vars = await director.getItemVariables(roomId);

    const byName = new Map<string, unknown>();
    for (const v of vars) byName.set(v.varName, v.value);

    const read = (...names: string[]): unknown => {
      for (const n of names) {
        if (!byName.has(n)) continue;
        const val = byName.get(n);
        if (val === "Undefined" || val === undefined || val === null) continue;
        return val;
      }
      return null;
    };

    const powerState = read("POWER_STATE");
    const volumeVal = read("CURRENT_VOLUME");
    const mutedVal = read("IS_MUTED");
    const videoSourceVal = read("CURRENT_VIDEO_DEVICE");
    const audioSourceVal = read("CURRENT_AUDIO_DEVICE");

    const audioSourceId = toInt(audioSourceVal);
    const videoSourceId = toInt(videoSourceVal);
    const videoActive = videoSourceId != null && videoSourceId !== 0;
    const audioActive = audioSourceId != null && audioSourceId !== 0;
    const isOn = Number(powerState ?? 0) !== 0 || videoActive || audioActive;
    const mode: RoomAvMode = videoActive
      ? "video"
      : audioActive
        ? "audio"
        : "off";

    return {
      room_id: roomId,
      is_on: isOn,
      volume: volumeVal == null ? -1 : toInt(volumeVal) ?? -1,
      muted: Number(mutedVal ?? 0) !== 0,
      mode,
      audio_source_id:
        audioSourceId && audioSourceId !== 0 ? audioSourceId : null,
      video_source_id:
        videoSourceId && videoSourceId !== 0 ? videoSourceId : null,
    };
  }

  async roomCommand(
    roomId: number,
    command: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    const director = await this.ensureDirector();
    await director.sendCommand(roomId, command, params);
  }

  async setRoomVolume(roomId: number, volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)));
    const director = await this.ensureDirector();
    await director.sendCommand(roomId, "SET_VOLUME_LEVEL", { LEVEL: clamped });
  }

  async toggleRoomMute(roomId: number): Promise<void> {
    const director = await this.ensureDirector();
    await director.sendCommand(roomId, "MUTE_TOGGLE");
  }

  async setRoomAudioSource(roomId: number, sourceId: number): Promise<void> {
    const director = await this.ensureDirector();
    await director.sendCommand(roomId, "SELECT_AUDIO_DEVICE", {
      deviceid: sourceId,
    });
  }

  async setRoomVideoSource(roomId: number, sourceId: number): Promise<void> {
    const director = await this.ensureDirector();
    await director.sendCommand(roomId, "SELECT_VIDEO_DEVICE", {
      deviceid: sourceId,
    });
  }

  async mediaTransport(
    roomId: number,
    action: "PLAY" | "PAUSE" | "STOP",
  ): Promise<void> {
    const director = await this.ensureDirector();
    await director.sendCommand(roomId, action);
  }

  // Browse a source's deep content (SiriusXM channels, Pandora stations, NAS
  // playlists/albums, broadcast TV channels, etc). Every SELECT_*_MEDIA command
  // on the room lists a `valueSrc.path` that returns mixed content across
  // every source wired into the room; each row carries `device_id`.
  //
  // For real sources we filter to the tapped source. For aggregator tiles
  // (Stations, Channels, …) we keep every row — that's exactly what their
  // cross-service browse view does in Navigator.
  async browseSourceMedia(
    roomId: number,
    sourceId: number,
    isVideo: boolean,
    aggregator: boolean,
  ): Promise<MediaBrowseGroupDTO[]> {
    const director = await this.ensureDirector();
    const cmds = await director
      .sendGet<DirectorCommand[]>(`/api/v1/items/${roomId}/commands`)
      .catch(() => [] as DirectorCommand[]);

    type Browse = {
      kind: string;
      isVideo: boolean;
      path: string;
      valueField: string;
      valueDisplay: string;
    };
    const browses: Browse[] = [];
    for (const c of cmds ?? []) {
      const cmd = String(c.command ?? "");
      const m = cmd.match(/^SELECT_(AUDIO|VIDEO)_MEDIA:(.+)$/);
      if (!m) continue;
      // Only include kinds that match the tile's audio/video context so an
      // audio aggregator ("Stations") doesn't spill movies into the sheet.
      if ((m[1] === "VIDEO") !== isVideo) continue;
      const p = c.params?.[0];
      const path = p?.valueSrc?.path;
      if (!path) continue;
      browses.push({
        kind: m[2],
        isVideo: m[1] === "VIDEO",
        path,
        valueField: p?.valueField ?? "id",
        valueDisplay: p?.valueDisplay ?? "{name}",
      });
    }

    const payloads = await Promise.all(
      browses.map((b) =>
        director
          .sendGet<Array<Record<string, unknown>>>(b.path)
          .catch(() => [] as Array<Record<string, unknown>>),
      ),
    );

    const groups: MediaBrowseGroupDTO[] = [];
    browses.forEach((b, i) => {
      const rows = payloads[i] ?? [];
      const matched = aggregator
        ? rows
        : rows.filter((row) => Number(row.device_id) === sourceId);
      if (matched.length === 0) return;
      const items: MediaBrowseItemDTO[] = matched.map((row) => ({
        id: Number(row[b.valueField] ?? row.id),
        label:
          renderTemplate(b.valueDisplay, row) ||
          String(row.name ?? row.title ?? row.id),
        img: row.img != null ? String(row.img) : null,
      }));
      groups.push({
        kind: b.kind,
        label: kindLabel(b.kind),
        isVideo: b.isVideo,
        items,
      });
    });
    return groups;
  }

  async selectRoomMedia(
    roomId: number,
    kind: string,
    isVideo: boolean,
    mediaId: number,
  ): Promise<void> {
    const director = await this.ensureDirector();
    const command = `SELECT_${isVideo ? "VIDEO" : "AUDIO"}_MEDIA:${kind}`;
    await director.sendCommand(roomId, command, {
      mediaid: mediaId,
      deselect: "1",
    });
  }

  async listClimate(): Promise<ClimateDeviceDTO[]> {
    const director = await this.ensureDirector();
    const raw = await director.getItemsByCategory("comfort");
    const items = keepLeaves(raw);
    // Keep items that actually expose HVAC_MODE — filters out any residual
    // hardware-layer entries that slip past the parent/leaf filter.
    const probed = await Promise.all(
      items.map(async (it) => {
        const mode = await director
          .getItemVariable(it.id, "HVAC_MODE")
          .catch(() => null);
        return mode != null ? it : null;
      }),
    );
    return probed
      .filter((it): it is DirectorItem => it !== null)
      .map(slimClimate);
  }

  async setClimate(
    itemId: number,
    payload: {
      heat_setpoint_f?: number;
      cool_setpoint_f?: number;
      hvac_mode?: string;
    },
  ): Promise<void> {
    const director = await this.ensureDirector();
    const applied: string[] = [];
    if (payload.heat_setpoint_f != null) {
      await director.sendCommand(itemId, "SET_SETPOINT_HEAT", {
        FAHRENHEIT: payload.heat_setpoint_f,
      });
      applied.push("heat");
    }
    if (payload.cool_setpoint_f != null) {
      await director.sendCommand(itemId, "SET_SETPOINT_COOL", {
        FAHRENHEIT: payload.cool_setpoint_f,
      });
      applied.push("cool");
    }
    if (payload.hvac_mode != null) {
      await director.sendCommand(itemId, "SET_MODE_HVAC", {
        MODE: payload.hvac_mode,
      });
      applied.push("mode");
    }
    if (applied.length === 0) {
      throw new Error("setClimate requires at least one field");
    }
  }
}

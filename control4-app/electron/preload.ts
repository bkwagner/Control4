// Renderer-side bridge. Exposes a typed `window.control4` object that funnels
// every call through IPC to the Electron main process, where the real client
// lives. Renderer-side type declarations are in src/lib/control4.d.ts.

import { contextBridge, ipcRenderer } from "electron";

type ClimatePayload = {
  heat_setpoint_f?: number;
  cool_setpoint_f?: number;
  hvac_mode?: string;
};

const api = {
  // Config
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (settings: {
    username: string;
    password: string;
    directorIp: string;
    controllerCommonName: string | null;
  }) => ipcRenderer.invoke("config:save", settings),
  clearConfig: () => ipcRenderer.invoke("config:clear"),

  // Rooms
  listRooms: () => ipcRenderer.invoke("rooms:list"),
  roomOff: (roomId: number) => ipcRenderer.invoke("rooms:off", roomId),

  // Lights
  listLights: () => ipcRenderer.invoke("lights:list"),
  setLightLevel: (itemId: number, level: number) =>
    ipcRenderer.invoke("lights:setLevel", itemId, level),

  // Items
  getItemVariables: (itemId: number) =>
    ipcRenderer.invoke("items:variables", itemId),

  // AV
  listMediaSources: () => ipcRenderer.invoke("av:sources"),
  getRoomAvState: (roomId: number) =>
    ipcRenderer.invoke("av:roomState", roomId),
  getAllRoomsAvState: (roomIds: number[]) =>
    ipcRenderer.invoke("av:allRoomsState", roomIds),
  setRoomVolume: (roomId: number, volume: number) =>
    ipcRenderer.invoke("av:volume", roomId, volume),
  toggleRoomMute: (roomId: number) =>
    ipcRenderer.invoke("av:muteToggle", roomId),
  setRoomAudioSource: (roomId: number, sourceId: number) =>
    ipcRenderer.invoke("av:audioSource", roomId, sourceId),
  setRoomVideoSource: (roomId: number, sourceId: number) =>
    ipcRenderer.invoke("av:videoSource", roomId, sourceId),
  mediaPlay: (roomId: number) => ipcRenderer.invoke("av:play", roomId),
  mediaPause: (roomId: number) => ipcRenderer.invoke("av:pause", roomId),
  mediaStop: (roomId: number) => ipcRenderer.invoke("av:stop", roomId),
  roomCommand: (
    roomId: number,
    command: string,
    params?: Record<string, unknown>,
  ) => ipcRenderer.invoke("av:roomCommand", roomId, command, params),
  browseSourceMedia: (
    roomId: number,
    sourceId: number,
    isVideo: boolean,
    aggregator: boolean,
  ) =>
    ipcRenderer.invoke(
      "av:browseSource",
      roomId,
      sourceId,
      isVideo,
      aggregator,
    ),
  selectRoomMedia: (
    roomId: number,
    kind: string,
    isVideo: boolean,
    mediaId: number,
  ) => ipcRenderer.invoke("av:selectMedia", roomId, kind, isVideo, mediaId),

  // Climate
  listClimate: () => ipcRenderer.invoke("climate:list"),
  setClimate: (itemId: number, payload: ClimatePayload) =>
    ipcRenderer.invoke("climate:set", itemId, payload),

  // Blinds
  listBlinds: () => ipcRenderer.invoke("blinds:list"),
  setBlindLevel: (itemId: number, level: number) =>
    ipcRenderer.invoke("blinds:setLevel", itemId, level),
  openBlind: (itemId: number) => ipcRenderer.invoke("blinds:open", itemId),
  closeBlind: (itemId: number) => ipcRenderer.invoke("blinds:close", itemId),
  stopBlind: (itemId: number) => ipcRenderer.invoke("blinds:stop", itemId),

  // Locks
  listLocks: () => ipcRenderer.invoke("locks:list"),
  setLock: (itemId: number, locked: boolean) =>
    ipcRenderer.invoke("locks:set", itemId, locked),

  // Security
  listSecurity: () => ipcRenderer.invoke("security:list"),
  armSecurity: (itemId: number, mode: "away" | "stay" | "night") =>
    ipcRenderer.invoke("security:arm", itemId, mode),
  disarmSecurity: (itemId: number, code: string) =>
    ipcRenderer.invoke("security:disarm", itemId, code),

  // App Info
  getVersion: () => ipcRenderer.invoke("app:getVersion"),

  // Updater
  updater: {
    getState: () => ipcRenderer.invoke("updater:getState"),
    check: () => ipcRenderer.invoke("updater:check"),
    installNow: () => ipcRenderer.invoke("updater:installNow"),
    onState: (cb: (state: unknown) => void) => {
      const listener = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on("updater:state", listener);
      return () => ipcRenderer.removeListener("updater:state", listener);
    },
  },

  // Events
  onItemChanged: (cb: (itemId: number) => void) => {
    const listener = (_e: unknown, id: number) => cb(id);
    ipcRenderer.on("events:itemChanged", listener);
    return () => ipcRenderer.removeListener("events:itemChanged", listener);
  },
};

contextBridge.exposeInMainWorld("control4", api);

export type Control4Api = typeof api;

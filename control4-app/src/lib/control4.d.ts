// Type declarations for the bridge exposed by electron/preload.ts.
// The preload script injects `window.control4` via contextBridge; this file
// tells the renderer TypeScript compiler what shape to expect.

import type {
  ClimateDevice,
  Light,
  MediaBrowseGroup,
  MediaSource,
  Room,
  RoomAvState,
} from "./types";

export interface AppSettings {
  username: string;
  password: string;
  directorIp: string;
  controllerCommonName: string | null;
}

export interface Control4Api {
  getConfig: () => Promise<AppSettings | null>;
  saveConfig: (settings: AppSettings) => Promise<true>;
  clearConfig: () => Promise<true>;

  listRooms: () => Promise<Room[]>;
  roomOff: (roomId: number) => Promise<void>;

  listLights: () => Promise<Light[]>;
  setLightLevel: (itemId: number, level: number) => Promise<void>;

  getItemVariables: (
    itemId: number,
  ) => Promise<Array<{ varName: string; value: unknown }>>;

  listMediaSources: () => Promise<MediaSource[]>;
  getRoomAvState: (roomId: number) => Promise<RoomAvState>;
  setRoomVolume: (roomId: number, volume: number) => Promise<void>;
  toggleRoomMute: (roomId: number) => Promise<void>;
  setRoomAudioSource: (roomId: number, sourceId: number) => Promise<void>;
  setRoomVideoSource: (roomId: number, sourceId: number) => Promise<void>;
  mediaPlay: (roomId: number) => Promise<void>;
  mediaPause: (roomId: number) => Promise<void>;
  mediaStop: (roomId: number) => Promise<void>;
  roomCommand: (
    roomId: number,
    command: string,
    params?: Record<string, unknown>,
  ) => Promise<void>;
  browseSourceMedia: (
    roomId: number,
    sourceId: number,
    isVideo: boolean,
    aggregator: boolean,
  ) => Promise<MediaBrowseGroup[]>;
  selectRoomMedia: (
    roomId: number,
    kind: string,
    isVideo: boolean,
    mediaId: number,
  ) => Promise<void>;

  listClimate: () => Promise<ClimateDevice[]>;
  setClimate: (
    itemId: number,
    payload: {
      heat_setpoint_f?: number;
      cool_setpoint_f?: number;
      hvac_mode?: string;
    },
  ) => Promise<void>;

  updater: {
    getState: () => Promise<UpdaterState>;
    check: () => Promise<UpdaterState>;
    installNow: () => Promise<void>;
    onState: (cb: (state: UpdaterState) => void) => () => void;
  };
}

export type UpdaterState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; version: string; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

declare global {
  interface Window {
    control4: Control4Api;
  }
}

export {};

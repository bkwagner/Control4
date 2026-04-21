// Renderer-side facade over the preload bridge. Components keep calling
// `api.listRooms()` etc., but every call now goes through IPC to the Electron
// main process (which owns the Control4 client) instead of HTTP to a backend.

export const api = {
  listRooms: () => window.control4.listRooms(),
  roomOff: (roomId: number) => window.control4.roomOff(roomId),

  listLights: () => window.control4.listLights(),
  setLightLevel: (itemId: number, level: number) =>
    window.control4.setLightLevel(itemId, level),

  getItemVariables: (itemId: number) =>
    window.control4.getItemVariables(itemId),

  listMediaSources: () => window.control4.listMediaSources(),
  getRoomAvState: (roomId: number) => window.control4.getRoomAvState(roomId),
  getAllRoomsAvState: (roomIds: number[]) =>
    window.control4.getAllRoomsAvState(roomIds),
  setRoomVolume: (roomId: number, volume: number) =>
    window.control4.setRoomVolume(roomId, volume),
  toggleRoomMute: (roomId: number) => window.control4.toggleRoomMute(roomId),
  setRoomAudioSource: (roomId: number, sourceId: number) =>
    window.control4.setRoomAudioSource(roomId, sourceId),
  setRoomVideoSource: (roomId: number, sourceId: number) =>
    window.control4.setRoomVideoSource(roomId, sourceId),
  mediaPlay: (roomId: number) => window.control4.mediaPlay(roomId),
  mediaPause: (roomId: number) => window.control4.mediaPause(roomId),
  mediaStop: (roomId: number) => window.control4.mediaStop(roomId),
  roomCommand: (
    roomId: number,
    command: string,
    params?: Record<string, unknown>,
  ) => window.control4.roomCommand(roomId, command, params),
  browseSourceMedia: (
    roomId: number,
    sourceId: number,
    isVideo: boolean,
    aggregator: boolean,
  ) => window.control4.browseSourceMedia(roomId, sourceId, isVideo, aggregator),
  selectRoomMedia: (
    roomId: number,
    kind: string,
    isVideo: boolean,
    mediaId: number,
  ) => window.control4.selectRoomMedia(roomId, kind, isVideo, mediaId),

  listClimate: () => window.control4.listClimate(),
  setClimate: (
    itemId: number,
    payload: {
      heat_setpoint_f?: number;
      cool_setpoint_f?: number;
      hvac_mode?: string;
    },
  ) => window.control4.setClimate(itemId, payload),

  listBlinds: () => window.control4.listBlinds(),
  setBlindLevel: (itemId: number, level: number) =>
    window.control4.setBlindLevel(itemId, level),
  openBlind: (itemId: number) => window.control4.openBlind(itemId),
  closeBlind: (itemId: number) => window.control4.closeBlind(itemId),
  stopBlind: (itemId: number) => window.control4.stopBlind(itemId),

  listLocks: () => window.control4.listLocks(),
  setLock: (itemId: number, locked: boolean) =>
    window.control4.setLock(itemId, locked),

  listSecurity: () => window.control4.listSecurity(),
  armSecurity: (itemId: number, mode: "away" | "stay" | "night") =>
    window.control4.armSecurity(itemId, mode),
  disarmSecurity: (itemId: number, code: string) =>
    window.control4.disarmSecurity(itemId, code),
};

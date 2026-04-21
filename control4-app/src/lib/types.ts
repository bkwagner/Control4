export interface Room {
  id: number;
  name: string;
  floorName: string | null;
  floorId: number | null;
  hasAv: boolean;
  hasAudio: boolean;
  hasVideo: boolean;
  hasMatrixAudio: boolean;
}

export interface Light {
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

export interface MediaSource {
  id: number;
  name: string;
  proxy: string | null;
  roomName: string | null;
  roomIds: number[];
  kind: SourceKind;
  matrixAudio: boolean;
  matrixVideo: boolean;
  aggregator: boolean;
}

export type RoomAvMode = "off" | "audio" | "video";

export interface NowPlaying {
  title: string | null;
  artist: string | null;
  album: string | null;
  channel: string | null;
  img_url: string | null;
  media_type: string | null;
}

export interface RoomAvState {
  room_id: number;
  is_on: boolean;
  volume: number;
  muted: boolean;
  mode: RoomAvMode;
  audio_source_id: number | null;
  video_source_id: number | null;
  now_playing: NowPlaying | null;
  matrix_source_id: number | null;
}

export interface ClimateDevice {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
}

export interface BlindDevice {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
}

export interface LockDevice {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
}

export interface SecurityDevice {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
}

export interface MediaBrowseItem {
  id: number;
  label: string;
  img: string | null;
}

export interface MediaBrowseGroup {
  kind: string;
  label: string;
  isVideo: boolean;
  items: MediaBrowseItem[];
}

export interface Room {
  id: number;
  name: string;
  floorName: string | null;
  floorId: number | null;
}

export interface Light {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
  level: number | null;
  state: number | null;
  dimmable: boolean;
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

export interface ClimateDevice {
  id: number;
  name: string;
  roomId: number | null;
  roomName: string | null;
}

export interface ItemVariable {
  varName: string;
  value: unknown;
}

export interface AppConfig {
  username: string;
  password: string;
  directorIp: string;
  controllerCommonName: string | null;
}

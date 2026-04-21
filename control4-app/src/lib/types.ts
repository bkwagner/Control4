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
  floorName: string | null;
  level: number | null;
  state: number | null;
  dimmable: boolean;
}

import type { Light, Room } from "./types";

const BASE_URL = "http://localhost:8000/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>("/health"),
  listRooms: () => request<Room[]>("/rooms"),
  roomOff: (roomId: number) =>
    request(`/rooms/${roomId}/off`, { method: "POST" }),
  listLights: () => request<Light[]>("/lights"),
  setLightLevel: (itemId: number, level: number) =>
    request(`/lights/${itemId}/level`, {
      method: "POST",
      body: JSON.stringify({ level }),
    }),
};

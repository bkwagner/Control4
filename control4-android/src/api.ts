import ReactNativeBlobUtil from 'react-native-blob-util';
import { AppConfig, ItemVariable, Light, Room, BlindDevice, LockDevice, SecurityDevice, ClimateDevice } from './types';

let directorIp: string | null = null;
let directorToken: string | null = null;

type HttpMethod = 'GET' | 'POST';

class Control4API {
  private baseURL = '';
  private headers: Record<string, string> = {};
  // Supplied by AuthContext: returns a fresh director token (or null if one
  // can't be obtained). Used to recover from an expired token mid-session.
  private refreshToken: (() => Promise<string | null>) | null = null;

  async setConfig(ip: string, token: string) {
    this.baseURL = `https://${ip}`;
    this.headers = { 'Authorization': `Bearer ${token}` };
    directorIp = ip;
    directorToken = token;
  }

  setTokenRefresher(fn: (() => Promise<string | null>) | null) {
    this.refreshToken = fn;
  }

  private async request<T>(method: HttpMethod, path: string, body?: any, retried = false): Promise<T> {
    const url = `${this.baseURL}${path}`;
    // TODO(cert pinning): `trusty` skips TLS verification for the director's
    // self-signed cert. Replace with a pinned-cert native module.
    const resp = await ReactNativeBlobUtil.config({ trusty: true }).fetch(
      method,
      url,
      { 'Content-Type': 'application/json', ...this.headers },
      body ? JSON.stringify(body) : undefined,
    );

    const status = resp.info().status;
    if (status === 401 && !retried && this.refreshToken) {
      const token = await this.refreshToken();
      if (token) {
        this.headers = { 'Authorization': `Bearer ${token}` };
        directorToken = token;
        return this.request<T>(method, path, body, true);
      }
    }
    if (status < 200 || status >= 300) {
      const text = String(await resp.text());
      throw new Error(`${method} ${path} -> HTTP ${status}: ${text.slice(0, 200)}`);
    }
    return resp.json() as T;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: any): Promise<T> {
    return this.request<T>('POST', path, body);
  }
}

const api = new Control4API();

export async function setDirectorConfig(ip: string, token: string) {
  await api.setConfig(ip, token);
}

export function setTokenRefresher(fn: (() => Promise<string | null>) | null) {
  api.setTokenRefresher(fn);
}

export async function listRooms(): Promise<Room[]> {
  const data = await api.get<any[]>('/api/v1/items');
  return data
    .filter((item: any) => item.typeName === 'room')
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      floorName: item.floorName || null,
      floorId: item.floorId || null,
    }));
}

export async function listLights(): Promise<Light[]> {
  const data = await api.get<any[]>('/api/v1/categories/lights');
  const results = await Promise.all(
    data.map(async (item: any) => {
      try {
        const vars = await getItemVariables(item.id);
        const levelVar = vars.find((v) => v.varName === 'LIGHT_LEVEL');
        const stateVar = vars.find((v) => v.varName === 'LIGHT_STATE');
        return {
          id: item.id,
          name: item.name,
          roomId: item.roomId || null,
          roomName: item.roomName || null,
          level: levelVar && typeof levelVar.value === 'number' ? levelVar.value : null,
          state: stateVar && typeof stateVar.value === 'number' ? stateVar.value : null,
          dimmable: !!levelVar,
        } as Light;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((l): l is Light => l !== null);
}

export async function listBlinds(): Promise<BlindDevice[]> {
  const data = await api.get<any[]>('/api/v1/items');
  return data
    .filter((item: any) => String(item.proxy || '').toLowerCase() === 'blind')
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      roomId: item.roomId || null,
      roomName: item.roomName || null,
    }));
}

export async function listLocks(): Promise<LockDevice[]> {
  const data = await api.get<any[]>('/api/v1/items');
  const lockProxies = ['lock_zigbee_baldwin_smartlock', 'relaysingle_doorlock_c4'];
  return data
    .filter((item: any) => lockProxies.includes(String(item.proxy || '').toLowerCase()))
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      roomId: item.roomId || null,
      roomName: item.roomName || null,
    }));
}

export async function listSecurity(): Promise<SecurityDevice[]> {
  const data = await api.get<any[]>('/api/v1/items');
  return data
    .filter(
      (item: any) =>
        String(item.proxy || '').toLowerCase() === 'security' &&
        !String(item.name || '').toLowerCase().includes('partition'),
    )
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      roomId: item.roomId || null,
      roomName: item.roomName || null,
    }));
}

export async function listClimate(): Promise<ClimateDevice[]> {
  const data = await api.get<any[]>('/api/v1/categories/comfort');
  return data.map((item: any) => ({
    id: item.id,
    name: item.name,
    roomId: item.roomId || null,
    roomName: item.roomName || null,
  }));
}

export async function getItemVariables(itemId: number): Promise<ItemVariable[]> {
  return api.get<ItemVariable[]>(`/api/v1/items/${itemId}/variables`);
}

export async function setLightLevel(itemId: number, level: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: 'SET_LEVEL',
    tParams: { LEVEL: clamped },
  });
}

export async function setBlindLevel(itemId: number, level: number): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: 'SET_LEVEL',
    tParams: { LEVEL: clamped },
  });
}

export async function openBlind(itemId: number): Promise<void> {
  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: 'OPEN',
    tParams: {},
  });
}

export async function closeBlind(itemId: number): Promise<void> {
  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: 'CLOSE',
    tParams: {},
  });
}

export async function setLock(itemId: number, locked: boolean): Promise<void> {
  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: locked ? 'LOCK' : 'UNLOCK',
    tParams: {},
  });
}

export async function armSecurity(itemId: number, mode: 'away' | 'stay' | 'night'): Promise<void> {
  const commands: Record<string, string> = {
    away: 'ARM_AWAY',
    stay: 'ARM_STAY',
    night: 'ARM_NIGHT',
  };
  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: commands[mode],
    tParams: {},
  });
}

export async function disarmSecurity(itemId: number, code: string): Promise<void> {
  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: 'DISARM',
    tParams: { CODE: code },
  });
}

export async function setClimate(
  itemId: number,
  payload: {
    heat_setpoint_f?: number;
    cool_setpoint_f?: number;
    hvac_mode?: string;
  },
): Promise<void> {
  const params: Record<string, any> = {};
  if (payload.heat_setpoint_f !== undefined) params.HEAT_SETPOINT_F = payload.heat_setpoint_f;
  if (payload.cool_setpoint_f !== undefined) params.COOL_SETPOINT_F = payload.cool_setpoint_f;
  if (payload.hvac_mode !== undefined) params.HVAC_MODE = payload.hvac_mode;

  await api.post(`/api/v1/items/${itemId}/commands`, {
    async: true,
    command: 'SET_CLIMATE',
    tParams: params,
  });
}

// Fast variant: categorize a single room's devices in one round trip of list
// calls, with no per-device variable fetches. Variables should be refreshed
// separately for just the room's devices.
export async function listRoomDevices(roomId: number): Promise<{
  lights: Light[];
  blinds: BlindDevice[];
  locks: LockDevice[];
  security: SecurityDevice[];
  climate: ClimateDevice[];
}> {
  const [items, lightsCat, comfortCat] = await Promise.all([
    api.get<any[]>('/api/v1/items'),
    api.get<any[]>('/api/v1/categories/lights'),
    api.get<any[]>('/api/v1/categories/comfort'),
  ]);

  const lockProxies = ['lock_zigbee_baldwin_smartlock', 'relaysingle_doorlock_c4'];
  const byRoom = <T extends { roomId: number | null }>(arr: T[]) =>
    arr.filter((d) => d.roomId === roomId);

  const shape = <T extends { id: number; name: string; roomId: number | null; roomName: string | null }>(
    item: any,
  ): T =>
    ({
      id: item.id,
      name: item.name,
      roomId: item.roomId || null,
      roomName: item.roomName || null,
    } as T);

  const lights: Light[] = byRoom(
    lightsCat.map((item: any) => ({
      ...shape<Light>(item),
      level: null,
      state: null,
      dimmable: false,
    })),
  );

  const climate: ClimateDevice[] = byRoom(comfortCat.map((item: any) => shape<ClimateDevice>(item)));

  const blinds: BlindDevice[] = byRoom(
    items
      .filter((item: any) => String(item.proxy || '').toLowerCase() === 'blind')
      .map((item: any) => shape<BlindDevice>(item)),
  );

  const locks: LockDevice[] = byRoom(
    items
      .filter((item: any) => lockProxies.includes(String(item.proxy || '').toLowerCase()))
      .map((item: any) => shape<LockDevice>(item)),
  );

  const security: SecurityDevice[] = byRoom(
    items
      .filter(
        (item: any) =>
          String(item.proxy || '').toLowerCase() === 'security' &&
          !String(item.name || '').toLowerCase().includes('partition'),
      )
      .map((item: any) => shape<SecurityDevice>(item)),
  );

  return { lights, blinds, locks, security, climate };
}

// Export api object for use in contexts
export const apiClient = {
  setDirectorConfig,
  setTokenRefresher,
  listRooms,
  listLights,
  listBlinds,
  listLocks,
  listSecurity,
  listClimate,
  listRoomDevices,
  getItemVariables,
  setLightLevel,
  setBlindLevel,
  openBlind,
  closeBlind,
  setLock,
  armSecurity,
  disarmSecurity,
  setClimate,
};

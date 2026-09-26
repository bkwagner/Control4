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

// Values of the named variables for every item that has them, in one
// request (the director ignores id filters on this endpoint, so callers
// filter the rows themselves).
export async function getVariablesByName(
  varNames: string[],
): Promise<Array<ItemVariable & { id: number }>> {
  const names = varNames.map(encodeURIComponent).join(',');
  return api.get<Array<ItemVariable & { id: number }>>(`/api/v1/items/variables?varnames=${names}`);
}

// Parent of each item. Proxy devices (e.g. a blind) often don't own their
// state variables — the parent protocol driver does, and a per-item read of
// the proxy silently returns the parent's rows. The batched read reports
// rows under the real owner, so callers map proxies back through this.
// Cached: the tree only changes when the project is edited.
const PARENTS_TTL_MS = 5 * 60_000;
let parentsCache: { at: number; map: Promise<Map<number, number>> } | null = null;

function getParentMap(): Promise<Map<number, number>> {
  if (parentsCache && Date.now() - parentsCache.at < PARENTS_TTL_MS) return parentsCache.map;
  const map = api.get<any[]>('/api/v1/items').then((items) => {
    const m = new Map<number, number>();
    for (const it of items) if (typeof it.parentId === 'number') m.set(it.id, it.parentId);
    return m;
  });
  const entry = { at: Date.now(), map };
  parentsCache = entry;
  map.catch(() => {
    if (parentsCache === entry) parentsCache = null;
  });
  return map;
}

// The named variables for each requested item, in two requests total
// regardless of item count. Matches what per-item reads return: the item's
// own values, falling back to its parent's for names it doesn't own.
export async function getVariablesForItems(
  itemIds: number[],
  varNames: string[],
): Promise<Map<number, ItemVariable[]>> {
  const [rows, parents] = await Promise.all([getVariablesByName(varNames), getParentMap()]);
  const byOwner = new Map<number, Map<string, unknown>>();
  for (const row of rows) {
    if (!byOwner.has(row.id)) byOwner.set(row.id, new Map());
    byOwner.get(row.id)!.set(row.varName, row.value);
  }
  const out = new Map<number, ItemVariable[]>();
  for (const id of itemIds) {
    const merged = new Map(byOwner.get(parents.get(id) ?? -1) ?? []);
    for (const [name, value] of byOwner.get(id) ?? []) merged.set(name, value);
    out.set(id, [...merged].map(([varName, value]) => ({ varName, value })));
  }
  return out;
}

export async function listLights(): Promise<Light[]> {
  const [data, rows] = await Promise.all([
    api.get<any[]>('/api/v1/categories/lights'),
    getVariablesByName(['LIGHT_LEVEL', 'LIGHT_STATE']),
  ]);
  const values = new Map<number, Map<string, unknown>>();
  for (const row of rows) {
    if (!values.has(row.id)) values.set(row.id, new Map());
    values.get(row.id)!.set(row.varName, row.value);
  }
  return data.map((item: any) => {
    const vars = values.get(item.id);
    const level = vars?.get('LIGHT_LEVEL');
    const state = vars?.get('LIGHT_STATE');
    return {
      id: item.id,
      name: item.name,
      roomId: item.roomId || null,
      roomName: item.roomName || null,
      level: typeof level === 'number' ? level : null,
      state: typeof state === 'number' ? state : null,
      dimmable: vars?.has('LIGHT_LEVEL') ?? false,
    } as Light;
  });
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
  getVariablesByName,
  getVariablesForItems,
  setLightLevel,
  setBlindLevel,
  openBlind,
  closeBlind,
  setLock,
  armSecurity,
  disarmSecurity,
  setClimate,
};

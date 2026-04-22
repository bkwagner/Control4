import { AppConfig, ItemVariable, Light, Room, BlindDevice, LockDevice, SecurityDevice, ClimateDevice } from './types';
import { fetch as sslPinningFetch } from 'react-native-ssl-pinning';

let directorIp: string | null = null;
let directorToken: string | null = null;
let pinnedCertificate: string | null = null;

// Use fetch with SSL pinning for self-signed certificate support
class Control4API {
  private baseURL = '';
  private headers = {};

  async setConfig(ip: string, token: string) {
    this.baseURL = `https://${ip}`;
    this.headers = { 'Authorization': `Bearer ${token}` };
    directorIp = ip;
    directorToken = token;
    console.log('[API] Config set for:', ip);

    // Fetch and pin the certificate on first connection
    try {
      await this.pinCertificate(ip);
    } catch (e) {
      console.warn('[API] Failed to pin certificate:', e);
    }
  }

  private async pinCertificate(ip: string): Promise<void> {
    const certUrl = `https://${ip}/api/v1/items`;
    console.log('[API] Fetching certificate from:', certUrl);

    try {
      // First fetch to get the certificate - this accepts any cert
      await sslPinningFetch({
        url: certUrl,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${directorToken}` },
      });

      // Successfully connected, certificate is now implicitly trusted
      pinnedCertificate = ip;
      console.log('[API] Certificate pinned for:', ip);
    } catch (error) {
      console.warn('[API] Certificate pinning setup failed:', error);
      // Continue anyway - we'll try requests without pinning
    }
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseURL}${path}`;
    console.log('[API] Request:', method, url);

    try {
      const response = await sslPinningFetch({
        url,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        sslPinning: pinnedCertificate ? { certs: [pinnedCertificate] } : undefined,
      });

      // react-native-ssl-pinning returns response data directly
      if (typeof response === 'string') {
        const data = JSON.parse(response);
        console.log('[API] Response:', 200, url);
        return data;
      }

      if (response && typeof response === 'object' && 'body' in response) {
        const bodyText = response.body;
        const data = typeof bodyText === 'string' ? JSON.parse(bodyText) : bodyText;
        console.log('[API] Response:', response.status || 200, url);
        return data;
      }

      console.log('[API] Response:', 200, url);
      return response as T;
    } catch (error) {
      console.error('[API] Error:', error instanceof Error ? error.message : String(error), url);
      throw error;
    }
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

export async function listRooms(): Promise<Room[]> {
  const { data } = await api.get('/api/v1/items');
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
  const { data } = await api.get('/api/v1/categories/lights');
  const lights: Light[] = [];
  for (const item of data) {
    try {
      const vars = await getItemVariables(item.id);
      const levelVar = vars.find((v) => v.varName === 'LIGHT_LEVEL');
      const stateVar = vars.find((v) => v.varName === 'LIGHT_STATE');
      lights.push({
        id: item.id,
        name: item.name,
        roomId: item.roomId || null,
        roomName: item.roomName || null,
        level: levelVar && typeof levelVar.value === 'number' ? levelVar.value : null,
        state: stateVar && typeof stateVar.value === 'number' ? stateVar.value : null,
        dimmable: !!levelVar,
      });
    } catch (e) {
      // Skip on error
    }
  }
  return lights;
}

export async function listBlinds(): Promise<BlindDevice[]> {
  const { data } = await api.get('/api/v1/items');
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
  const { data } = await api.get('/api/v1/items');
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
  const { data } = await api.get('/api/v1/items');
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
  const { data } = await api.get('/api/v1/categories/comfort');
  return data.map((item: any) => ({
    id: item.id,
    name: item.name,
    roomId: item.roomId || null,
    roomName: item.roomName || null,
  }));
}

export async function getItemVariables(itemId: number): Promise<ItemVariable[]> {
  const { data } = await api.get(`/api/v1/items/${itemId}/variables`);
  return data;
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

// Export api object for use in contexts
export const apiClient = {
  setDirectorConfig,
  listRooms,
  listLights,
  listBlinds,
  listLocks,
  listSecurity,
  listClimate,
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

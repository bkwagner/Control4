import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import io from 'socket.io-client';
import { useAuth } from './AuthContext';
import { apiClient } from '../api';
import { ItemVariable } from '../types';

type DeviceStateContextType = {
  states: Map<number, ItemVariable[]>;
  loading: boolean;
  error: string | null;
  refreshItem: (itemId: number) => Promise<void>;
  refreshAllItems: (itemIds: number[]) => Promise<void>;
};

// Every variable name the screens read from `states`. Keep in sync when a
// screen starts reading a new variable.
const DISPLAY_VARS = [
  'LIGHT_LEVEL',
  'LIGHT_STATE',
  'LEVEL',
  'CURRENT_LEVEL',
  'HVAC_MODE',
  'TEMPERATURE_F',
  'HEAT_SETPOINT_F',
  'COOL_SETPOINT_F',
  'LOCK_STATE',
  'LOCKED_STATE',
  'LOCKSTATE',
  'LockState',
  'ALARM_STATE',
  'PARTITION_STATE',
];

const DeviceStateContext = createContext<DeviceStateContextType | undefined>(undefined);

export function DeviceStateProvider({ children }: { children: React.ReactNode }) {
  const { config } = useAuth();
  const [states, setStates] = useState<Map<number, ItemVariable[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshItem = useCallback(async (itemId: number) => {
    try {
      setError(null);
      const vars = await apiClient.getItemVariables(itemId);
      setStates((prev) => {
        const next = new Map(prev);
        next.set(itemId, vars);
        return next;
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to fetch variables';
      setError(errorMsg);
      console.error('Failed to refresh item:', e);
    }
  }, []);

  // Refreshing several items (a whole screen) reads just the variables the
  // screens display, for every item, in one batched request instead of one
  // full read per item. A single item (after an action or event) keeps the
  // full per-item read.
  const refreshAllItems = useCallback(async (itemIds: number[]) => {
    if (itemIds.length === 1) {
      await refreshItem(itemIds[0]);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const byItem = await apiClient.getVariablesForItems(itemIds, DISPLAY_VARS);
      setStates((prev) => {
        const next = new Map(prev);
        for (const [id, vars] of byItem) next.set(id, vars);
        return next;
      });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to fetch item states';
      setError(errorMsg);
      console.error('Failed to refresh all items:', e);
    } finally {
      setLoading(false);
    }
  }, [refreshItem]);

  // Live updates from the director's event feed. The director speaks the
  // legacy Socket.IO v2 protocol (so socket.io-client 2.x), on the ROOT
  // namespace: connect -> director emits `clientId` -> GET a subscriptionId
  // for it -> emit `startSubscription` -> item events arrive as events named
  // after the subscriptionId. TLS to the director's self-signed cert is
  // pinned natively (plugins/with-director-trust), which is what lets React
  // Native's WebSocket connect at all.
  useEffect(() => {
    if (!config) return;
    const { directorIp, directorToken } = config;

    const socket = io(`wss://${directorIp}`, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      forceNew: true,
      // engine.io-client 3 passes these to React Native's WebSocket.
      ...({ extraHeaders: { JWT: directorToken } } as object),
    });
    let subscriptionId: string | null = null;
    let closed = false;

    const onItemEvent = (message: unknown) => {
      const msgs = Array.isArray(message) ? message : [message];
      for (const m of msgs) {
        if (!m || typeof m !== 'object') continue;
        const msg = m as Record<string, unknown>;
        if ('status' in msg) {
          socket.emit('2');
          continue;
        }
        const itemId = msg['iddevice'];
        if (typeof itemId !== 'number') continue;
        // A motor/protocol driver may report changes shown on its proxy.
        apiClient
          .itemsAffectedBy(itemId)
          .then((ids) => Promise.all(ids.map((id) => refreshItem(id))))
          .catch(() => undefined);
      }
    };

    socket.on('disconnect', () => {
      if (subscriptionId) socket.off(subscriptionId);
      subscriptionId = null;
    });

    socket.on('clientId', async (clientId: string) => {
      socket.emit('2probe');
      if (subscriptionId) return;
      try {
        const url =
          `https://${directorIp}/api/v1/items/datatoui` +
          `?JWT=${encodeURIComponent(directorToken)}` +
          `&SubscriptionClient=${encodeURIComponent(clientId)}`;
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        const data = (await resp.json()) as { subscriptionId?: string };
        if (!data.subscriptionId) throw new Error(`no subscriptionId (HTTP ${resp.status})`);
        if (closed) return;
        subscriptionId = data.subscriptionId;
        socket.on(subscriptionId, onItemEvent);
        socket.emit('startSubscription', subscriptionId);
      } catch (e) {
        console.warn('[ws] subscription failed; retrying in 5s', e);
        setTimeout(() => {
          if (!closed) socket.disconnect().connect();
        }, 5000);
      }
    });

    return () => {
      closed = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, [config, refreshItem]);

  return (
    <DeviceStateContext.Provider value={{ states, loading, error, refreshItem, refreshAllItems }}>
      {children}
    </DeviceStateContext.Provider>
  );
}

export function useDeviceState() {
  const context = useContext(DeviceStateContext);
  if (context === undefined) {
    throw new Error('useDeviceState must be used within DeviceStateProvider');
  }
  return context;
}

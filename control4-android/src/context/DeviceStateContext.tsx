import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import ReactNativeBlobUtil from 'react-native-blob-util';
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
  const [socket, setSocket] = useState<Socket | null>(null);

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

  // WebSocket connection setup
  useEffect(() => {
    if (!config) return;

    try {
      console.log('Connecting to WebSocket:', `wss://${config.directorIp}/api/v1/items/datatoui`);
      const newSocket = io(`wss://${config.directorIp}/api/v1/items/datatoui`, {
        auth: { token: config.directorToken },
        query: { JWT: config.directorToken },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        rejectUnauthorized: false,
        forceNew: true,
      } as any);

      let subscriptionId: string | null = null;

      newSocket.on('clientId', async (clientId: string) => {
        console.log('Received clientId:', clientId);
        newSocket.emit('2probe');

        try {
          const params = new URLSearchParams({
            JWT: config.directorToken,
            SubscriptionClient: clientId,
          });
          const url = `https://${config.directorIp}/api/v1/items/datatoui?${params}`;

          console.log('Fetching subscription ID from:', url);
          const resp = await ReactNativeBlobUtil.config({ trusty: true }).fetch(
            'GET',
            url,
            { 'Accept': 'application/json' },
          );

          const status = resp.info().status;
          if (status < 200 || status >= 300) {
            throw new Error(`HTTP ${status}: ${resp.text()}`);
          }

          const data = resp.json() as { subscriptionId?: string };
          console.log('Subscription response:', data);
          if (data.subscriptionId) {
            subscriptionId = data.subscriptionId;
            newSocket.emit('startSubscription', subscriptionId);
            console.log('Subscription started:', subscriptionId);
          } else {
            console.warn('No subscriptionId in response:', data);
          }
        } catch (e) {
          console.error('Failed to get subscription ID:', e);
        }
      });

      newSocket.onAny((event: string, message: unknown) => {
        if (subscriptionId && event === subscriptionId) {
          const msgs = Array.isArray(message) ? message : [message];
          for (const m of msgs) {
            if (!m || typeof m !== 'object') continue;
            const msg = m as Record<string, unknown>;
            if ('status' in msg) {
              newSocket.emit('2');
              continue;
            }
            const itemId = msg['iddevice'];
            if (typeof itemId === 'number') {
              refreshItem(itemId).catch(console.error);
            }
          }
        }
      });

      newSocket.on('connect', () => {
        console.log('WebSocket connected to', config.directorIp);
      });

      newSocket.on('disconnect', (reason: string) => {
        console.log('WebSocket disconnected:', reason);
      });

      newSocket.on('error', (error: any) => {
        console.error('WebSocket error:', error, JSON.stringify(error));
      });

      newSocket.on('connect_error', (error: any) => {
        console.error('WebSocket connect_error:', error?.message || error, error?.data);
      });

      setSocket(newSocket);

      return () => {
        try {
          newSocket.disconnect();
        } catch (e) {
          console.error('Error disconnecting socket:', e);
        }
      };
    } catch (e) {
      console.error('Failed to setup WebSocket:', e);
    }
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

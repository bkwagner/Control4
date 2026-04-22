import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
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

  const refreshAllItems = useCallback(async (itemIds: number[]) => {
    try {
      setLoading(true);
      setError(null);
      const allStates = new Map<number, ItemVariable[]>();
      for (const id of itemIds) {
        const vars = await apiClient.getItemVariables(id);
        allStates.set(id, vars);
      }
      setStates(allStates);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to fetch item states';
      setError(errorMsg);
      console.error('Failed to refresh all items:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // WebSocket connection setup
  useEffect(() => {
    if (!config) return;

    try {
      const newSocket = io(`wss://${config.directorIp}/api/v1/items/datatoui`, {
        transports: ['websocket'],
        extraHeaders: { JWT: config.password },
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
      } as any);

      let subscriptionId: string | null = null;

      newSocket.on('clientId', async (clientId: string) => {
        console.log('Received clientId:', clientId);
        newSocket.emit('2probe');

        try {
          const params = new URLSearchParams({
            JWT: config.password,
            SubscriptionClient: clientId,
          });
          const url = `https://${config.directorIp}/api/v1/items/datatoui?${params}`;

          const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
          });

          const data = (await response.json()) as { subscriptionId?: string };
          if (data.subscriptionId) {
            subscriptionId = data.subscriptionId;
            newSocket.emit('startSubscription', subscriptionId);
            console.log('Subscription started:', subscriptionId);
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

      newSocket.on('error', (error: any) => {
        console.error('WebSocket error:', error);
        setError('WebSocket connection error');
      });

      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    } catch (e) {
      console.error('Failed to setup WebSocket:', e);
      setError('Failed to setup WebSocket');
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

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { AppConfig } from '../types';
import { apiClient } from '../api';
import { authenticate, AuthRejectedError } from '../auth';

type AppCreds = Omit<AppConfig, 'directorToken' | 'tokenExpiresAt'>;

type AuthContextType = {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  setConfig: (creds: AppCreds) => Promise<void>;
  clearConfig: () => Promise<void>;
  isConfigured: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORE_KEY = 'control4_config';
// Refresh if token expires within this window.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// setTimeout overflows above 2^31-1 ms (~24.8 days).
const MAX_TIMER_MS = 2_147_483_647;

async function exchangeCredsForConfig(creds: AppCreds): Promise<AppConfig> {
  const { directorToken, controllerCommonName } = await authenticate(
    creds.username,
    creds.password,
    creds.controllerCommonName,
  );
  return {
    ...creds,
    controllerCommonName,
    directorToken: directorToken.token,
    tokenExpiresAt: directorToken.expiresAt,
  };
}

function needsRefresh(c: AppConfig): boolean {
  // Also true for configs saved before tokens were stored (fields missing).
  return !c.directorToken || !(c.tokenExpiresAt - Date.now() > REFRESH_MARGIN_MS);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  const inflight = useRef<Promise<AppConfig | null> | null>(null);

  const applyConfig = useCallback(async (next: AppConfig | null) => {
    configRef.current = next;
    setConfigState(next);
    if (next) await apiClient.setDirectorConfig(next.directorIp, next.directorToken);
  }, []);

  // Exchange the stored credentials for a fresh director token. Shared by
  // launch, app-foreground, the expiry timer and the API's 401 retry. Only an
  // explicit rejection from the cloud drops stored credentials; network
  // failures keep them so the next attempt can succeed.
  const refresh = useCallback(
    (force: boolean): Promise<AppConfig | null> => {
      const current = configRef.current;
      if (!current) return Promise.resolve(null);
      if (!force && !needsRefresh(current)) return Promise.resolve(current);
      if (inflight.current) return inflight.current;

      inflight.current = (async () => {
        try {
          const next = await exchangeCredsForConfig(current);
          await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next));
          await applyConfig(next);
          setError(null);
          return next;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (e instanceof AuthRejectedError) {
            await SecureStore.deleteItemAsync(STORE_KEY).catch(() => undefined);
            await applyConfig(null);
            setError(`Control4 rejected the saved sign-in. Please sign in again. (${msg})`);
          } else {
            setError(`Couldn't reach Control4 to refresh access; will retry. (${msg})`);
          }
          return null;
        } finally {
          inflight.current = null;
        }
      })();
      return inflight.current;
    },
    [applyConfig],
  );

  // Launch: load stored config, then refresh if the token is stale.
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(STORE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored) as AppConfig;
        await applyConfig(parsed);
        await refresh(false);
      } catch (e) {
        // Unreadable store entry: nothing usable to keep.
        console.error('Failed to load stored config:', e);
        setError(e instanceof Error ? e.message : 'Failed to load config');
      } finally {
        setLoading(false);
      }
    })();
  }, [applyConfig, refresh]);

  // Let the API client recover from a 401 mid-session.
  useEffect(() => {
    apiClient.setTokenRefresher(async () => (await refresh(true))?.directorToken ?? null);
    return () => apiClient.setTokenRefresher(null);
  }, [refresh]);

  // Refresh when the app returns to the foreground (timers don't run while
  // Android has the app suspended).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(false);
    });
    return () => sub.remove();
  }, [refresh]);

  // Refresh shortly before expiry while the app stays open.
  const expiresAt = config?.tokenExpiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const delay = Math.min(
      MAX_TIMER_MS,
      Math.max(30_000, expiresAt - REFRESH_MARGIN_MS - Date.now()),
    );
    const timer = setTimeout(() => void refresh(false), delay);
    return () => clearTimeout(timer);
  }, [expiresAt, refresh]);

  const setConfig = async (creds: AppCreds) => {
    try {
      setError(null);
      const full = await exchangeCredsForConfig(creds);
      await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(full));
      await applyConfig(full);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to save config';
      setError(errorMsg);
      throw e;
    }
  };

  const clearConfig = async () => {
    try {
      await SecureStore.deleteItemAsync(STORE_KEY);
      await applyConfig(null);
    } catch (e) {
      console.error('Failed to clear config:', e);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        config,
        loading,
        error,
        setConfig,
        clearConfig,
        isConfigured: config !== null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

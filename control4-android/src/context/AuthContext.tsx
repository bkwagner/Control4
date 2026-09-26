import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AppConfig } from '../types';
import { apiClient } from '../api';
import { authenticate } from '../auth';

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

// Refresh if token expires within this window.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        const stored = await SecureStore.getItemAsync('control4_config');
        if (!stored) return;

        let parsed = JSON.parse(stored) as AppConfig;

        // Refresh token if expired, close to expiry, or missing (migration from old schema).
        if (
          !parsed.directorToken ||
          !parsed.tokenExpiresAt ||
          parsed.tokenExpiresAt - Date.now() < REFRESH_MARGIN_MS
        ) {
          console.log('[Auth] Token expired or missing, refreshing…');
          parsed = await exchangeCredsForConfig(parsed);
          await SecureStore.setItemAsync('control4_config', JSON.stringify(parsed));
        }

        setConfigState(parsed);
        await apiClient.setDirectorConfig(parsed.directorIp, parsed.directorToken);
      } catch (e) {
        // If refresh fails, drop the stored config so the user can re-enter creds.
        console.error('Failed to load/refresh config:', e);
        await SecureStore.deleteItemAsync('control4_config').catch(() => undefined);
        setError(e instanceof Error ? e.message : 'Failed to load config');
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const setConfig = async (creds: AppCreds) => {
    try {
      setError(null);
      const full = await exchangeCredsForConfig(creds);
      await SecureStore.setItemAsync('control4_config', JSON.stringify(full));
      setConfigState(full);
      await apiClient.setDirectorConfig(full.directorIp, full.directorToken);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : 'Failed to save config';
      setError(errorMsg);
      throw e;
    }
  };

  const clearConfig = async () => {
    try {
      await SecureStore.deleteItemAsync('control4_config');
      setConfigState(null);
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

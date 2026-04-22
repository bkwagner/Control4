import React, { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AppConfig } from '../types';
import { apiClient } from '../api';

type AuthContextType = {
  config: AppConfig | null;
  loading: boolean;
  error: string | null;
  setConfig: (config: AppConfig) => Promise<void>;
  clearConfig: () => Promise<void>;
  isConfigured: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        setLoading(true);
        const stored = await SecureStore.getItemAsync('control4_config');
        if (stored) {
          const parsed = JSON.parse(stored) as AppConfig;
          setConfigState(parsed);
          await apiClient.setDirectorConfig(parsed.directorIp, parsed.password);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
        setError(e instanceof Error ? e.message : 'Failed to load config');
      } finally {
        setLoading(false);
      }
    };

    loadConfig();
  }, []);

  const setConfig = async (newConfig: AppConfig) => {
    try {
      setError(null);
      await SecureStore.setItemAsync('control4_config', JSON.stringify(newConfig));
      setConfigState(newConfig);
      await apiClient.setDirectorConfig(newConfig.directorIp, newConfig.password);
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

import React, { useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Switch,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { apiClient } from '../api';
import { useDeviceState } from '../context/DeviceStateContext';
import { Light } from '../types';

export function LightsScreen() {
  const { states, refreshAllItems } = useDeviceState();
  const [lights, setLights] = useState<Light[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localLevels, setLocalLevels] = useState<Record<number, number>>({});

  const loadLights = async () => {
    try {
      setError(null);
      const data = await apiClient.listLights();
      setLights(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((l) => l.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load lights');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiClient.listLights();
      setLights(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((l) => l.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadLights();
  }, []);

  const getLightLevel = (lightId: number): number => {
    if (lightId in localLevels) {
      return localLevels[lightId];
    }
    const vars = states.get(lightId);
    if (!vars) return 0;
    const levelVar = vars.find((v) => v.varName === 'LIGHT_LEVEL');
    return typeof levelVar?.value === 'number' ? levelVar.value : 0;
  };

  const isLightOn = (lightId: number): boolean => {
    const vars = states.get(lightId);
    if (!vars) return false;
    const stateVar = vars.find((v) => v.varName === 'LIGHT_STATE');
    return typeof stateVar?.value === 'number' && stateVar.value > 0;
  };

  const handleToggleLight = async (light: Light) => {
    try {
      const newLevel = isLightOn(light.id) ? 0 : 100;
      setLocalLevels((prev) => ({ ...prev, [light.id]: newLevel }));
      await apiClient.setLightLevel(light.id, newLevel);
      await refreshAllItems([light.id]);
    } catch (e) {
      setLocalLevels((prev) => ({ ...prev, [light.id]: getLightLevel(light.id) }));
      console.error('Failed to toggle light:', e);
    }
  };

  const handleSetLevel = async (lightId: number, level: number) => {
    setLocalLevels((prev) => ({ ...prev, [lightId]: level }));
  };

  const handleSetLevelEnd = async (lightId: number) => {
    try {
      const level = localLevels[lightId] ?? getLightLevel(lightId);
      await apiClient.setLightLevel(lightId, Math.round(level));
      await refreshAllItems([lightId]);
    } catch (e) {
      setLocalLevels((prev) => ({ ...prev, [lightId]: getLightLevel(lightId) }));
      console.error('Failed to set light level:', e);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={lights}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.lightItem}>
          <View style={styles.lightHeader}>
            <View style={styles.lightInfo}>
              <Text style={styles.lightName}>{item.name}</Text>
              {item.roomName && <Text style={styles.roomName}>{item.roomName}</Text>}
            </View>
            {item.dimmable ? (
              <TouchableOpacity onPress={() => handleToggleLight(item)}>
                <View style={[styles.toggleCircle, isLightOn(item.id) && styles.toggleOn]}>
                  <Text style={styles.toggleText}>{isLightOn(item.id) ? 'ON' : 'OFF'}</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <Switch
                value={isLightOn(item.id)}
                onValueChange={() => handleToggleLight(item)}
              />
            )}
          </View>
          {item.dimmable && (
            <View style={styles.sliderContainer}>
              <Text style={styles.levelText}>{Math.round(getLightLevel(item.id))}%</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={100}
                step={1}
                value={getLightLevel(item.id)}
                onValueChange={(val) => handleSetLevel(item.id, val)}
                onSlidingComplete={() => handleSetLevelEnd(item.id)}
              />
            </View>
          )}
        </View>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={lights.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No lights found</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 8,
  },
  lightHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lightInfo: {
    flex: 1,
  },
  lightName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  roomName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  toggleCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ddd',
  },
  toggleOn: {
    backgroundColor: '#FFD700',
    borderColor: '#FFA500',
  },
  toggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  sliderContainer: {
    marginTop: 12,
  },
  levelText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  error: {
    color: '#FF3B30',
    fontSize: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});

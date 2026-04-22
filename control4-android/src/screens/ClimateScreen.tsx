import React, { useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { apiClient } from '../api';
import { useDeviceState } from '../context/DeviceStateContext';
import { ClimateDevice } from '../types';

export function ClimateScreen() {
  const { states, refreshAllItems } = useDeviceState();
  const [devices, setDevices] = useState<ClimateDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localTemp, setLocalTemp] = useState<Record<number, number>>({});
  const [localMode, setLocalMode] = useState<Record<number, string>>({});

  const loadClimate = async () => {
    try {
      setError(null);
      const data = await apiClient.listClimate();
      setDevices(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((c) => c.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load climate devices');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiClient.listClimate();
      setDevices(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((c) => c.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadClimate();
  }, []);

  const getTemperature = (deviceId: number, type: 'heat' | 'cool'): number => {
    const key = `${deviceId}-${type}`;
    if (key in localTemp) {
      return localTemp[key as any] ?? 70;
    }
    const vars = states.get(deviceId);
    if (!vars) return 70;
    const varName = type === 'heat' ? 'HEAT_SETPOINT_F' : 'COOL_SETPOINT_F';
    const tempVar = vars.find((v) => v.varName === varName);
    return typeof tempVar?.value === 'number' ? tempVar.value : 70;
  };

  const getMode = (deviceId: number): string => {
    if (deviceId in localMode) {
      return localMode[deviceId];
    }
    const vars = states.get(deviceId);
    if (!vars) return 'Auto';
    const modeVar = vars.find((v) => v.varName === 'HVAC_MODE');
    return typeof modeVar?.value === 'string' ? modeVar.value : 'Auto';
  };

  const getCurrentTemp = (deviceId: number): number => {
    const vars = states.get(deviceId);
    if (!vars) return 70;
    const tempVar = vars.find((v) => v.varName === 'TEMPERATURE_F');
    return typeof tempVar?.value === 'number' ? tempVar.value : 70;
  };

  const handleSetHeatTemp = async (deviceId: number, temp: number) => {
    setLocalTemp((prev) => ({ ...prev, [`${deviceId}-heat`]: temp }));
  };

  const handleSetHeatTempEnd = async (deviceId: number) => {
    try {
      const temp = localTemp[`${deviceId}-heat` as any] ?? getTemperature(deviceId, 'heat');
      await apiClient.setClimate(deviceId, {
        heat_setpoint_f: Math.round(temp),
      });
      await refreshAllItems([deviceId]);
    } catch (e) {
      setLocalTemp((prev) => {
        const next = { ...prev };
        delete (next as any)[`${deviceId}-heat`];
        return next;
      });
      console.error('Failed to set temperature:', e);
    }
  };

  const handleSetCoolTemp = async (deviceId: number, temp: number) => {
    setLocalTemp((prev) => ({ ...prev, [`${deviceId}-cool`]: temp }));
  };

  const handleSetCoolTempEnd = async (deviceId: number) => {
    try {
      const temp = localTemp[`${deviceId}-cool` as any] ?? getTemperature(deviceId, 'cool');
      await apiClient.setClimate(deviceId, {
        cool_setpoint_f: Math.round(temp),
      });
      await refreshAllItems([deviceId]);
    } catch (e) {
      setLocalTemp((prev) => {
        const next = { ...prev };
        delete (next as any)[`${deviceId}-cool`];
        return next;
      });
      console.error('Failed to set temperature:', e);
    }
  };

  const handleSetMode = async (deviceId: number, mode: string) => {
    try {
      setLocalMode((prev) => ({ ...prev, [deviceId]: mode }));
      await apiClient.setClimate(deviceId, {
        hvac_mode: mode,
      });
      await refreshAllItems([deviceId]);
    } catch (e) {
      setLocalMode((prev) => ({ ...prev, [deviceId]: getMode(deviceId) }));
      console.error('Failed to set mode:', e);
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
      data={devices}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.climateItem}>
          <View style={styles.header}>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              {item.roomName && <Text style={styles.roomName}>{item.roomName}</Text>}
            </View>
            <View style={styles.currentTemp}>
              <Text style={styles.currentTempText}>{Math.round(getCurrentTemp(item.id))}°F</Text>
            </View>
          </View>

          <View style={styles.modeButtons}>
            {['Auto', 'Heat', 'Cool', 'Off'].map((mode) => (
              <TouchableOpacity
                key={mode}
                style={[
                  styles.modeButton,
                  getMode(item.id) === mode && styles.modeButtonActive,
                ]}
                onPress={() => handleSetMode(item.id, mode)}
              >
                <Text
                  style={[
                    styles.modeButtonText,
                    getMode(item.id) === mode && styles.modeButtonTextActive,
                  ]}
                >
                  {mode}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.settingContainer}>
            <Text style={styles.settingLabel}>Heat Setpoint</Text>
            <View style={styles.tempSetting}>
              <Text style={styles.tempValue}>{Math.round(getTemperature(item.id, 'heat'))}°F</Text>
              <Slider
                style={styles.slider}
                minimumValue={50}
                maximumValue={85}
                step={1}
                value={getTemperature(item.id, 'heat')}
                onValueChange={(val) => handleSetHeatTemp(item.id, val)}
                onSlidingComplete={() => handleSetHeatTempEnd(item.id)}
              />
            </View>
          </View>

          <View style={styles.settingContainer}>
            <Text style={styles.settingLabel}>Cool Setpoint</Text>
            <View style={styles.tempSetting}>
              <Text style={styles.tempValue}>{Math.round(getTemperature(item.id, 'cool'))}°F</Text>
              <Slider
                style={styles.slider}
                minimumValue={65}
                maximumValue={95}
                step={1}
                value={getTemperature(item.id, 'cool')}
                onValueChange={(val) => handleSetCoolTemp(item.id, val)}
                onSlidingComplete={() => handleSetCoolTempEnd(item.id)}
              />
            </View>
          </View>
        </View>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={devices.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No climate devices found</Text>
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
  climateItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  roomName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  currentTemp: {
    backgroundColor: '#FF9500',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  currentTempText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modeButtons: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  modeButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  modeButtonActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  modeButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  modeButtonTextActive: {
    color: '#fff',
  },
  settingContainer: {
    marginBottom: 16,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  tempSetting: {
    alignItems: 'center',
  },
  tempValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 4,
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

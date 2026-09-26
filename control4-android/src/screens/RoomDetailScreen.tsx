import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Switch,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { apiClient } from '../api';
import { useDeviceState } from '../context/DeviceStateContext';
import type { Light, BlindDevice, LockDevice, SecurityDevice, ClimateDevice } from '../types';
import type { RoomsStackParamList } from './RoomsStack';

type Props = NativeStackScreenProps<RoomsStackParamList, 'RoomDetail'>;

export function RoomDetailScreen({ route }: Props) {
  const { roomId, roomName } = route.params;
  const { states, refreshAllItems } = useDeviceState();

  const [lights, setLights] = useState<Light[]>([]);
  const [blinds, setBlinds] = useState<BlindDevice[]>([]);
  const [locks, setLocks] = useState<LockDevice[]>([]);
  const [security, setSecurity] = useState<SecurityDevice[]>([]);
  const [climate, setClimate] = useState<ClimateDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const devices = await apiClient.listRoomDevices(roomId);
      setLights(devices.lights);
      setBlinds(devices.blinds);
      setLocks(devices.locks);
      setSecurity(devices.security);
      setClimate(devices.climate);
      const ids = [
        ...devices.lights.map((d) => d.id),
        ...devices.locks.map((d) => d.id),
        ...devices.blinds.map((d) => d.id),
      ];
      if (ids.length > 0) await refreshAllItems(ids);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load room');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [roomId, refreshAllItems]);

  useEffect(() => {
    load();
  }, [load]);

  const isLightOn = (id: number): boolean => {
    const vars = states.get(id);
    const v = vars?.find((x) => x.varName === 'LIGHT_STATE');
    return typeof v?.value === 'number' && v.value > 0;
  };

  const isLocked = (id: number): boolean => {
    const vars = states.get(id);
    const v = vars?.find((x) => x.varName === 'LOCK_STATE' || x.varName === 'LockState');
    return typeof v?.value === 'number' ? v.value > 0 : v?.value === true || v?.value === 'true';
  };

  const handleToggleLight = async (light: Light) => {
    try {
      const level = isLightOn(light.id) ? 0 : 100;
      await apiClient.setLightLevel(light.id, level);
      await refreshAllItems([light.id]);
    } catch (e) {
      console.error('toggle light failed:', e);
    }
  };

  const handleToggleLock = async (lock: LockDevice) => {
    try {
      await apiClient.setLock(lock.id, !isLocked(lock.id));
      await refreshAllItems([lock.id]);
    } catch (e) {
      console.error('toggle lock failed:', e);
    }
  };

  const handleOpenBlind = async (blind: BlindDevice) => {
    try {
      await apiClient.openBlind(blind.id);
      await refreshAllItems([blind.id]);
    } catch (e) {
      console.error('open blind failed:', e);
    }
  };

  const handleCloseBlind = async (blind: BlindDevice) => {
    try {
      await apiClient.closeBlind(blind.id);
      await refreshAllItems([blind.id]);
    } catch (e) {
      console.error('close blind failed:', e);
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

  const total =
    lights.length + blinds.length + locks.length + security.length + climate.length;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <Text style={styles.roomTitle}>{roomName}</Text>

      {total === 0 && <Text style={styles.emptyText}>No devices in this room</Text>}

      {lights.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lights</Text>
          {lights.map((l) => (
            <View key={l.id} style={styles.row}>
              <Text style={styles.name}>{l.name}</Text>
              <Switch value={isLightOn(l.id)} onValueChange={() => handleToggleLight(l)} />
            </View>
          ))}
        </View>
      )}

      {blinds.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Blinds</Text>
          {blinds.map((b) => (
            <View key={b.id} style={styles.row}>
              <Text style={styles.name}>{b.name}</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => handleOpenBlind(b)}
                >
                  <Text style={styles.buttonText}>Open</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.smallButton}
                  onPress={() => handleCloseBlind(b)}
                >
                  <Text style={styles.buttonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {locks.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Locks</Text>
          {locks.map((lk) => (
            <View key={lk.id} style={styles.row}>
              <Text style={styles.name}>{lk.name}</Text>
              <Switch value={isLocked(lk.id)} onValueChange={() => handleToggleLock(lk)} />
            </View>
          ))}
        </View>
      )}

      {climate.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Climate</Text>
          {climate.map((c) => (
            <View key={c.id} style={styles.row}>
              <Text style={styles.name}>{c.name}</Text>
            </View>
          ))}
        </View>
      )}

      {security.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Security</Text>
          {security.map((s) => (
            <View key={s.id} style={styles.row}>
              <Text style={styles.name}>{s.name}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  roomTitle: { fontSize: 24, fontWeight: '700', color: '#000', padding: 16 },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 8,
    padding: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#eee',
  },
  name: { fontSize: 16, color: '#000', flex: 1 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  smallButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#007AFF',
    borderRadius: 6,
  },
  buttonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  error: { color: '#FF3B30', fontSize: 16 },
  emptyText: { textAlign: 'center', color: '#999', padding: 24 },
});

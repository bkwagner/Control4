import React, { useEffect, useState } from 'react';
import {
  View,
  FlatList,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
  TextInput,
} from 'react-native';
import { apiClient } from '../api';
import { useDeviceState } from '../context/DeviceStateContext';
import { SecurityDevice } from '../types';

export function SecurityScreen() {
  const { states, refreshAllItems } = useDeviceState();
  const [devices, setDevices] = useState<SecurityDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disarmCode, setDisarmCode] = useState('');
  const [disarmingId, setDisarmingId] = useState<number | null>(null);

  const loadSecurity = async () => {
    try {
      setError(null);
      const data = await apiClient.listSecurity();
      setDevices(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((s) => s.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load security devices');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiClient.listSecurity();
      setDevices(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((s) => s.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSecurity();
  }, []);

  const getAlarmState = (deviceId: number): string => {
    const vars = states.get(deviceId);
    if (!vars) return 'Unknown';
    const stateVar = vars.find((v) => v.varName === 'ALARM_STATE');
    const partitionVar = vars.find((v) => v.varName === 'PARTITION_STATE');

    if (typeof stateVar?.value === 'string') {
      return stateVar.value;
    }
    if (typeof partitionVar?.value === 'number') {
      const state = partitionVar.value;
      if (state === 1) return 'Armed Away';
      if (state === 2) return 'Armed Stay';
      if (state === 3) return 'Armed Night';
      if (state === 0) return 'Disarmed';
    }
    return 'Unknown';
  };

  const handleArm = async (deviceId: number, mode: 'away' | 'stay' | 'night') => {
    try {
      await apiClient.armSecurity(deviceId, mode);
      await refreshAllItems([deviceId]);
      Alert.alert('Success', `Alarm armed in ${mode} mode`);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to arm alarm');
    }
  };

  const handleDisarm = (deviceId: number) => {
    setDisarmingId(deviceId);
    Alert.prompt(
      'Disarm Alarm',
      'Enter your disarm code:',
      [
        { text: 'Cancel', onPress: () => setDisarmingId(null), style: 'cancel' },
        {
          text: 'Disarm',
          onPress: async (code: string | undefined) => {
            if (!code) {
              Alert.alert('Error', 'Please enter a code');
              return;
            }
            try {
              await apiClient.disarmSecurity(deviceId, code);
              await refreshAllItems([deviceId]);
              Alert.alert('Success', 'Alarm disarmed');
              setDisarmCode('');
            } catch (e) {
              Alert.alert('Error', 'Failed to disarm alarm');
            } finally {
              setDisarmingId(null);
            }
          },
        },
      ],
      'secure-text',
    );
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
        <View style={styles.securityItem}>
          <View style={styles.header}>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              {item.roomName && <Text style={styles.roomName}>{item.roomName}</Text>}
            </View>
            <View style={[styles.badge, styles.badgeSecondary]}>
              <Text style={styles.badgeText}>{getAlarmState(item.id)}</Text>
            </View>
          </View>

          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={[styles.button, styles.buttonAway]}
              onPress={() => handleArm(item.id, 'away')}
            >
              <Text style={styles.buttonText}>Arm Away</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonStay]}
              onPress={() => handleArm(item.id, 'stay')}
            >
              <Text style={styles.buttonText}>Arm Stay</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.buttonGroup}>
            <TouchableOpacity
              style={[styles.button, styles.buttonNight]}
              onPress={() => handleArm(item.id, 'night')}
            >
              <Text style={styles.buttonText}>Arm Night</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.buttonDisarm]}
              onPress={() => handleDisarm(item.id)}
            >
              <Text style={styles.buttonText}>Disarm</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={devices.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No security devices found</Text>
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
  securityItem: {
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
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  badgeSecondary: {
    backgroundColor: '#E3F2FD',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976D2',
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonAway: {
    backgroundColor: '#FF3B30',
  },
  buttonStay: {
    backgroundColor: '#FF9500',
  },
  buttonNight: {
    backgroundColor: '#34C759',
  },
  buttonDisarm: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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

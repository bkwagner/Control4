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
import { apiClient } from '../api';
import { useDeviceState } from '../context/DeviceStateContext';
import { LockDevice } from '../types';

export function LocksScreen() {
  const { states, refreshAllItems } = useDeviceState();
  const [locks, setLocks] = useState<LockDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStates, setLocalStates] = useState<Record<number, boolean>>({});

  const loadLocks = async () => {
    try {
      setError(null);
      const data = await apiClient.listLocks();
      setLocks(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((l) => l.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load locks');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiClient.listLocks();
      setLocks(data);
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
    loadLocks();
  }, []);

  const isLocked = (lockId: number): boolean => {
    if (lockId in localStates) {
      return localStates[lockId];
    }
    const vars = states.get(lockId);
    if (!vars) return false;
    const lockVar = vars.find((v) => v.varName === 'LOCKSTATE' || v.varName === 'LOCKED_STATE');
    return typeof lockVar?.value === 'number' && lockVar.value > 0;
  };

  const handleToggleLock = async (lock: LockDevice) => {
    try {
      const currentLocked = isLocked(lock.id);
      const newLocked = !currentLocked;
      setLocalStates((prev) => ({ ...prev, [lock.id]: newLocked }));
      await apiClient.setLock(lock.id, newLocked);
      await refreshAllItems([lock.id]);
    } catch (e) {
      setLocalStates((prev) => ({ ...prev, [lock.id]: isLocked(lock.id) }));
      console.error('Failed to toggle lock:', e);
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
      data={locks}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.lockItem}
          onPress={() => handleToggleLock(item)}
          activeOpacity={0.7}
        >
          <View style={styles.lockInfo}>
            <Text style={styles.lockName}>{item.name}</Text>
            {item.roomName && <Text style={styles.roomName}>{item.roomName}</Text>}
          </View>
          <View
            style={[
              styles.lockStatus,
              isLocked(item.id) ? styles.locked : styles.unlocked,
            ]}
          >
            <Text style={styles.statusText}>
              {isLocked(item.id) ? '🔒' : '🔓'}
            </Text>
            <Text style={styles.statusLabel}>
              {isLocked(item.id) ? 'Locked' : 'Unlocked'}
            </Text>
          </View>
        </TouchableOpacity>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={locks.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No locks found</Text>
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
  lockItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lockInfo: {
    flex: 1,
  },
  lockName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  roomName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  lockStatus: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locked: {
    backgroundColor: '#E8F5E9',
  },
  unlocked: {
    backgroundColor: '#FFEBEE',
  },
  statusText: {
    fontSize: 24,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    color: '#333',
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

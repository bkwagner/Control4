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
import { BlindDevice } from '../types';

export function BlindsScreen() {
  const { states, refreshAllItems } = useDeviceState();
  const [blinds, setBlinds] = useState<BlindDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localLevels, setLocalLevels] = useState<Record<number, number>>({});

  const loadBlinds = async () => {
    try {
      setError(null);
      const data = await apiClient.listBlinds();
      setBlinds(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((b) => b.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load blinds');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const data = await apiClient.listBlinds();
      setBlinds(data);
      if (data.length > 0) {
        await refreshAllItems(data.map((b) => b.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadBlinds();
  }, []);

  const getBlindLevel = (blindId: number): number => {
    if (blindId in localLevels) {
      return localLevels[blindId];
    }
    const vars = states.get(blindId);
    if (!vars) return 0;
    const levelVar = vars.find((v) => v.varName === 'LEVEL');
    return typeof levelVar?.value === 'number' ? levelVar.value : 0;
  };

  const handleOpen = async (blindId: number) => {
    try {
      setLocalLevels((prev) => ({ ...prev, [blindId]: 100 }));
      await apiClient.openBlind(blindId);
      await refreshAllItems([blindId]);
    } catch (e) {
      setLocalLevels((prev) => ({ ...prev, [blindId]: getBlindLevel(blindId) }));
      console.error('Failed to open blind:', e);
    }
  };

  const handleClose = async (blindId: number) => {
    try {
      setLocalLevels((prev) => ({ ...prev, [blindId]: 0 }));
      await apiClient.closeBlind(blindId);
      await refreshAllItems([blindId]);
    } catch (e) {
      setLocalLevels((prev) => ({ ...prev, [blindId]: getBlindLevel(blindId) }));
      console.error('Failed to close blind:', e);
    }
  };

  const handleSetLevel = async (blindId: number, level: number) => {
    setLocalLevels((prev) => ({ ...prev, [blindId]: level }));
  };

  const handleSetLevelEnd = async (blindId: number) => {
    try {
      const level = localLevels[blindId] ?? getBlindLevel(blindId);
      await apiClient.setBlindLevel(blindId, Math.round(level));
      await refreshAllItems([blindId]);
    } catch (e) {
      setLocalLevels((prev) => ({ ...prev, [blindId]: getBlindLevel(blindId) }));
      console.error('Failed to set blind level:', e);
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
      data={blinds}
      keyExtractor={(item) => String(item.id)}
      renderItem={({ item }) => (
        <View style={styles.blindItem}>
          <View style={styles.blindHeader}>
            <View style={styles.blindInfo}>
              <Text style={styles.blindName}>{item.name}</Text>
              {item.roomName && <Text style={styles.roomName}>{item.roomName}</Text>}
            </View>
          </View>
          <View style={styles.levelDisplay}>
            <Text style={styles.levelText}>{Math.round(getBlindLevel(item.id))}%</Text>
          </View>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={getBlindLevel(item.id)}
            onValueChange={(val) => handleSetLevel(item.id, val)}
            onSlidingComplete={() => handleSetLevelEnd(item.id)}
          />
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.closeButton]} onPress={() => handleClose(item.id)}>
              <Text style={styles.buttonText}>Close</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.openButton]} onPress={() => handleOpen(item.id)}>
              <Text style={styles.buttonText}>Open</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      contentContainerStyle={blinds.length === 0 ? styles.emptyContainer : undefined}
      ListEmptyComponent={
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>No blinds found</Text>
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
  blindItem: {
    backgroundColor: '#fff',
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 8,
  },
  blindHeader: {
    marginBottom: 12,
  },
  blindInfo: {
    flex: 1,
  },
  blindName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
  },
  roomName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  levelDisplay: {
    alignItems: 'center',
    marginBottom: 8,
  },
  levelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#007AFF',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  closeButton: {
    backgroundColor: '#FF3B30',
  },
  openButton: {
    backgroundColor: '#34C759',
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

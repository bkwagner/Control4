import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RoomsScreen } from './RoomsScreen';
import { RoomDetailScreen } from './RoomDetailScreen';

export type RoomsStackParamList = {
  RoomsList: undefined;
  RoomDetail: { roomId: number; roomName: string };
};

const Stack = createNativeStackNavigator<RoomsStackParamList>();

export function RoomsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="RoomsList"
        component={RoomsScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="RoomDetail"
        component={RoomDetailScreen}
        options={{ title: '' }}
      />
    </Stack.Navigator>
  );
}

import 'react-native-gesture-handler';
import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DeviceStateProvider } from './context/DeviceStateContext';
import { NavigationContainer, NavigationIndependentTree } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LoginScreen } from './screens/LoginScreen';
import { RoomsScreen } from './screens/RoomsScreen';
import { LightsScreen } from './screens/LightsScreen';
import { BlindsScreen } from './screens/BlindsScreen';
import { LocksScreen } from './screens/LocksScreen';
import { SecurityScreen } from './screens/SecurityScreen';
import { ClimateScreen } from './screens/ClimateScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function DeviceTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: any;

          switch (route.name) {
            case 'Rooms':
              iconName = focused ? 'home' : 'home-outline';
              break;
            case 'Lights':
              iconName = focused ? 'bulb' : 'bulb-outline';
              break;
            case 'Blinds':
              iconName = focused ? 'eye' : 'eye-outline';
              break;
            case 'Locks':
              iconName = focused ? 'lock-closed' : 'lock-closed-outline';
              break;
            case 'Security':
              iconName = focused ? 'shield' : 'shield-outline';
              break;
            case 'Climate':
              iconName = focused ? 'thermometer' : 'thermometer-outline';
              break;
            default:
              iconName = 'circle';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: '#999',
        headerShown: true,
        headerSafeAreaInsets: { top: 0 },
      })}
    >
      <Tab.Screen
        name="Rooms"
        component={RoomsScreen}
        options={{ title: 'Rooms' }}
      />
      <Tab.Screen
        name="Lights"
        component={LightsScreen}
        options={{ title: 'Lights' }}
      />
      <Tab.Screen
        name="Blinds"
        component={BlindsScreen}
        options={{ title: 'Blinds' }}
      />
      <Tab.Screen
        name="Locks"
        component={LocksScreen}
        options={{ title: 'Locks' }}
      />
      <Tab.Screen
        name="Security"
        component={SecurityScreen}
        options={{ title: 'Security' }}
      />
      <Tab.Screen
        name="Climate"
        component={ClimateScreen}
        options={{ title: 'Climate' }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const { isConfigured, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isConfigured ? (
        <Stack.Screen name="Login" component={LoginScreen} />
      ) : (
        <Stack.Screen name="Devices" component={DeviceTabs} />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <NavigationIndependentTree>
      <AuthProvider>
        <DeviceStateProvider>
          <NavigationContainer>
            <AppNavigator />
          </NavigationContainer>
        </DeviceStateProvider>
      </AuthProvider>
    </NavigationIndependentTree>
  );
}

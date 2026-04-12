import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiClient } from './src/api/client';
import { isSupportedTeacherRole } from './src/config';
import { clearAuthToken, getAuthToken } from './src/auth/session';
import { initializeQueueDatabase, listQueueItems } from './src/queue/storage';
import { LoginScreen } from './src/screens/LoginScreen';
import { RosterScreen } from './src/screens/RosterScreen';
import { QueueScreen } from './src/screens/QueueScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { colors } from './src/theme';
import { User } from './src/types';

type TabParamList = {
  Roster: undefined;
  Queue: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [queueBadge, setQueueBadge] = useState(0);
  const navigationRef = useRef<NavigationContainerRef<TabParamList>>(null);

  useEffect(() => {
    (async () => {
      try {
        await initializeQueueDatabase();
        const token = await getAuthToken();
        if (!token) return;

        apiClient.setToken(token);
        const currentUser = await apiClient.getCurrentUser();
        if (!isSupportedTeacherRole(currentUser.role)) {
          await clearAuthToken();
          return;
        }
        setUser(currentUser);
      } catch {
        await clearAuthToken();
        apiClient.setToken(null);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!user) return;
    const updateBadge = async () => {
      try {
        const items = await listQueueItems();
        const active = items.filter(
          (i) => i.status !== 'completed' && i.status !== 'failed',
        ).length;
        setQueueBadge(active);
      } catch {
        // ignore
      }
    };
    updateBadge();
    const interval = setInterval(updateBadge, 10_000);
    return () => clearInterval(interval);
  }, [user]);

  const handleLogout = useCallback(async () => {
    await clearAuthToken();
    apiClient.setToken(null);
    setUser(null);
  }, []);

  const handleLogin = useCallback((loggedInUser: User) => {
    setUser(loggedInUser);
  }, []);

  const handleNavigateToQueue = useCallback(() => {
    navigationRef.current?.navigate('Queue');
  }, []);

  if (restoring) {
    return (
      <SafeAreaProvider>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  if (!user) {
    return (
      <SafeAreaProvider>
        <LoginScreen onLogin={handleLogin} />
        <StatusBar style="auto" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.gray400,
            tabBarStyle: {
              borderTopColor: colors.gray200,
              borderTopWidth: StyleSheet.hairlineWidth,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '500',
            },
          }}
        >
          <Tab.Screen
            name="Roster"
            options={{
              tabBarLabel: 'Worksheets',
              tabBarIcon: ({ color }) => (
                <Text style={{ fontSize: 20, color }}>📋</Text>
              ),
            }}
          >
            {() => (
              <RosterScreen
                user={user}
                onNavigateToQueue={handleNavigateToQueue}
              />
            )}
          </Tab.Screen>
          <Tab.Screen
            name="Queue"
            options={{
              tabBarLabel: 'Queue',
              tabBarIcon: ({ color }) => (
                <Text style={{ fontSize: 20, color }}>📤</Text>
              ),
              tabBarBadge: queueBadge > 0 ? queueBadge : undefined,
              tabBarBadgeStyle: { backgroundColor: colors.primary },
            }}
          >
            {() => <QueueScreen />}
          </Tab.Screen>
          <Tab.Screen
            name="Settings"
            options={{
              tabBarLabel: 'Settings',
              tabBarIcon: ({ color }) => (
                <Text style={{ fontSize: 20, color }}>⚙️</Text>
              ),
            }}
          >
            {() => <SettingsScreen user={user} onLogout={handleLogout} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.white,
  },
});

import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiClient } from './src/api/client';
import { isSupportedTeacherRole } from './src/config';
import { clearAuthToken, getAuthToken } from './src/auth/session';
import { useGradingJobs } from './src/hooks/useGradingJobs';
import { initializeQueueDatabase, listQueueItems } from './src/queue/storage';
import { processUploadQueue } from './src/queue/uploader';
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

function MainTabs({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [queueBadge, setQueueBadge] = useState(0);
  const { activeCount } = useGradingJobs();

  // Badge count + auto-process queue every 15 seconds
  useEffect(() => {
    const tick = async () => {
      try {
        const items = await listQueueItems();
        const active = items.filter(
          (i) => i.status !== 'completed' && i.status !== 'failed',
        ).length;
        setQueueBadge(active);

        // Auto-process if there are queued/failed items
        const needsProcessing = items.some(
          (i) => i.status === 'queued' || i.status === 'uploading' || i.status === 'uploaded',
        );
        if (needsProcessing) {
          await processUploadQueue(apiClient).catch(() => undefined);
          // Re-check badge after processing
          const updated = await listQueueItems();
          setQueueBadge(
            updated.filter((i) => i.status !== 'completed' && i.status !== 'failed').length,
          );
        }
      } catch {
        // ignore
      }
    };
    tick();
    const interval = setInterval(tick, 15_000);
    return () => clearInterval(interval);
  }, []);

  const badgeCount = queueBadge + activeCount;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray400,
        tabBarStyle: {
          borderTopColor: colors.gray200,
          borderTopWidth: StyleSheet.hairlineWidth,
          ...Platform.select({
            android: { height: 64, paddingBottom: 8, paddingTop: 4 },
            ios: {},
          }),
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
          tabBarIcon: ({ color, size }) => (<Ionicons name="document-text-outline" size={size} color={color} />),
        }}
      >
        {() => <RosterScreen user={user} />}
      </Tab.Screen>
      <Tab.Screen
        name="Queue"
        options={{
          tabBarLabel: 'Queue',
          tabBarIcon: ({ color, size }) => (<Ionicons name="cloud-upload-outline" size={size} color={color} />),
          tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary },
        }}
      >
        {() => <QueueScreen user={user} />}
      </Tab.Screen>
      <Tab.Screen
        name="Settings"
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (<Ionicons name="settings-outline" size={size} color={color} />),
        }}
      >
        {() => <SettingsScreen user={user} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);

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

  const handleLogout = useCallback(async () => {
    await clearAuthToken();
    apiClient.setToken(null);
    setUser(null);
  }, []);

  const handleLogin = useCallback((loggedInUser: User) => {
    setUser(loggedInUser);
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
      <NavigationContainer>
        <MainTabs user={user} onLogout={handleLogout} />
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

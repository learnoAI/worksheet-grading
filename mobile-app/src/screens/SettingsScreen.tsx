import React from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fontSize, spacing, borderRadius } from '../theme';
import { User } from '../types';

function avatarColor(name: string): string {
  const hues = ['#0D9488', '#3B82F6', '#D54B43', '#D97706', '#059669', '#EA580C'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hues[Math.abs(hash) % hues.length];
}

interface SettingsScreenProps {
  user: User;
  onLogout: () => void;
}

export function SettingsScreen({ user, onLogout }: SettingsScreenProps) {
  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: onLogout },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.sectionHeader}>Account</Text>
      <View style={styles.section}>
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={[styles.avatar, { backgroundColor: avatarColor(user.name || user.username) }]}>
              <Text style={styles.avatarText}>
                {(user.name || user.username).charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user.name || user.username}</Text>
              <Text style={styles.profileRole}>{user.role}</Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.card}>
          <Pressable
            style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            onPress={handleSignOut}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.versionText}>Teacher Capture v1.0.0</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.gray50,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.gray900,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    letterSpacing: -0.5,
  },
  section: {
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.lg,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.gray200,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.white,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    color: colors.gray900,
  },
  profileRole: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    marginTop: 2,
  },
  menuRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  menuRowPressed: {
    backgroundColor: colors.gray50,
  },
  signOutText: {
    fontSize: fontSize.md,
    color: colors.red,
    fontWeight: '500',
  },
  sectionHeader: {
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.gray400,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  versionText: {
    fontSize: fontSize.caption,
    color: colors.gray400,
    textAlign: 'center',
    marginTop: spacing.xxl * 2,
  },
});

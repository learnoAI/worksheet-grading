import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, apiClient } from '../api/client';
import { saveAuthToken } from '../auth/session';
import { API_BASE_URL, isSupportedTeacherRole } from '../config';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, spacing, borderRadius, cardShadow } from '../theme';
import { User } from '../types';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      Alert.alert('Error', 'Username and password are required.');
      return;
    }

    setLoading(true);
    try {
      const { user, token } = await apiClient.login(trimmedUsername, password);

      if (!isSupportedTeacherRole(user.role)) {
        Alert.alert('Access Denied', 'Only teachers, admins, and superadmins can use this app.');
        return;
      }

      await saveAuthToken(token);
      apiClient.setToken(token);
      onLogin(user);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : 'Unable to connect. Check your network and try again.';
      Alert.alert('Login Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >
        <View style={styles.iconContainer}>
          <View style={styles.appIcon}>
            <Ionicons name="school" size={36} color={colors.white} />
          </View>
        </View>
        <Text style={styles.title}>Teacher Capture</Text>
        <Text style={styles.subtitle}>Sign in to get started</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.gray400}
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
          editable={!loading}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.gray400}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!loading}
          onSubmitEditing={handleLogin}
        />

        <Pressable
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </Pressable>

        <Text style={styles.endpoint} numberOfLines={1}>
          {API_BASE_URL}
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.loginBg,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  appIcon: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xxl,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...cardShadow,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.gray900,
    textAlign: 'center',
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.gray500,
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: fontSize.md,
    color: colors.gray900,
    marginBottom: spacing.md,
    backgroundColor: colors.white,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...cardShadow,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.white,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  endpoint: {
    fontSize: fontSize.xs,
    color: colors.gray400,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});

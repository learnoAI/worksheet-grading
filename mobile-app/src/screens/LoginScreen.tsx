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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError, apiClient } from '../api/client';
import { saveAuthToken } from '../auth/session';
import { API_BASE_URL, isSupportedTeacherRole } from '../config';
import { colors, fontSize, spacing, borderRadius } from '../theme';
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
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xxl,
    paddingBottom: 80,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.gray900,
    marginBottom: spacing.xs,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.md,
    color: colors.gray500,
    marginBottom: spacing.xxl * 1.5,
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
    borderRadius: borderRadius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: spacing.lg,
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

import * as SecureStore from 'expo-secure-store';

const tokenKey = 'teacher-capture-token';

export async function saveAuthToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(tokenKey, token);
}

export async function getAuthToken(): Promise<string | null> {
  return SecureStore.getItemAsync(tokenKey);
}

export async function clearAuthToken(): Promise<void> {
  await SecureStore.deleteItemAsync(tokenKey);
}

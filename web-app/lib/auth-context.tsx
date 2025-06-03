'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, authAPI, AuthResponse } from './api';

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    error: string | null;
    login: (username: string, password: string) => Promise<AuthResponse>;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Check if user is already logged in
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const userData = await authAPI.getCurrentUser();
                setUser(userData);
            } catch (err) {
                console.error('Authentication error:', err);
                document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
            }
            setIsLoading(false);
        };

        checkAuth();
    }, []);    // Login function
    const login = async (username: string, password: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await authAPI.login(username, password);
            // Set cookie with token
            document.cookie = `token=${response.token}; path=/; max-age=86400; secure; samesite=strict`;
            setUser(response.user);
            return response;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    // Logout function
    const logout = () => {
        document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{ user, isLoading, error, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
} 
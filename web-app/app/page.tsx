'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function HomePage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    if (!isLoading && !hasRedirected) {
      setHasRedirected(true);
      
      if (user) {
        // Use window.location to prevent race conditions with middleware redirects
        window.location.href = '/dashboard';
      } else {
        router.push('/login');
      }
    }
  }, [user, isLoading, router, hasRedirected]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h1 className="text-2xl font-bold mb-4">Worksheet Grading App</h1>
        <p>Redirecting...</p>
      </div>
    </div>
  );
}

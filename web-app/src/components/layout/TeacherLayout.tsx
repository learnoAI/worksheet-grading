import React from 'react';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface TeacherLayoutProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
}

export function TeacherLayout({ 
  children, 
  title = "AssessWise",
  description 
}: TeacherLayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && (!user || user.role !== 'TEACHER')) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex items-center space-x-2">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-3 md:px-4 lg:px-8 py-3 md:py-4 flex justify-between items-center">
          <div>
            <h1 className="text-lg md:text-xl font-bold">{title}</h1>
            {description && (
              <p className="text-sm text-gray-600 mt-1">{description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="text-xs md:text-sm text-gray-600 hidden sm:block">
              Logged in as <span className="font-medium">{user.username}</span> (Teacher)
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-2 md:px-4 lg:px-8 py-3 md:py-6">
        {children}
      </div>
    </div>
  );
}

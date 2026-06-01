'use client';

import { Workspace } from '@/components/layout/Workspace';
import { useAuthStore } from '@/lib/store/auth';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const setUser = useAuthStore((s) => s.setUser);
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    if (!hasHydrated) return;

    let cancelled = false;
    async function verifySession() {
      if (isAuthenticated) {
        setCheckingSession(false);
        return;
      }

      try {
        const res = await fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          const user = json.data?.user ?? json.data;
          if (user?.id && !cancelled) {
            setUser({
              id: String(user.id),
              email: String(user.email ?? ''),
              name: String(user.name ?? ''),
              roles: Array.isArray(user.roles) ? user.roles : [],
              permissions: Array.isArray(user.permissions) ? user.permissions : [],
            });
            useAuthStore.setState({ isAuthenticated: true });
            setCheckingSession(false);
            return;
          }
        }
      } catch {}

      if (!cancelled) {
        setCheckingSession(false);
        router.replace('/login');
      }
    }

    verifySession();
    return () => { cancelled = true; };
  }, [hasHydrated, isAuthenticated, router, setUser]);

  if (!hasHydrated || checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#e8eaf0]">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return <Workspace>{children}</Workspace>;
}

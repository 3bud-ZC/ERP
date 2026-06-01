'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import { ArrowLeft, LockKeyhole, Mail } from 'lucide-react';
import { BRAND } from '@/lib/branding';

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'فشل تسجيل الدخول');
      }

      // Sync user into Zustand store so dashboard layout sees isAuthenticated=true
      const { id, email: userEmail, name, roles, permissions } = data.data;
      setUser({ id, email: userEmail, name, roles, permissions });
      useAuthStore.setState({ isAuthenticated: true });

      router.replace('/dashboard');
    } catch (err: any) {
      const errorMessage = err?.message || err?.toString() || 'Unknown error';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#e8eaf0] flex items-center justify-center px-4 py-8" dir="rtl">
      <div className="w-full max-w-md neo-raised rounded-[24px] p-8 sm:p-10">
        <div className="mb-8 text-center flex flex-col items-center">
          <div className="w-16 h-16 neo-raised rounded-full flex items-center justify-center mb-4 text-indigo-700 font-black text-2xl">
            OG
          </div>
          <h1 className="text-3xl font-black text-indigo-600">{BRAND.name}</h1>
          <p className="text-sm text-slate-500 mt-1">{BRAND.taglineAr}</p>
        </div>

        <h2 className="text-2xl font-bold text-slate-800 mb-6 text-right">تسجيل الدخول</h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
              البريد الإلكتروني
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full neo-inset rounded-xl px-4 py-3.5 pr-10 text-slate-950 outline-none focus:ring-4 focus:ring-indigo-500/15"
                placeholder="admin@erp.com"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
              كلمة المرور
            </label>
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full neo-inset rounded-xl px-4 py-3.5 pr-10 text-slate-950 outline-none focus:ring-4 focus:ring-indigo-500/15"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl neo-raised px-4 py-3.5 font-bold text-indigo-700 transition hover:text-indigo-800 active:scale-[0.99] focus:outline-none focus:ring-4 focus:ring-indigo-500/15 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'جاري تسجيل الدخول...' : 'دخول النظام'}
            {!loading && <ArrowLeft className="h-4 w-4" />}
          </button>
        </form>

        <div className="mt-6 rounded-xl neo-inset px-4 py-3 text-center text-xs text-slate-500">
          <p>للحصول على بيانات الدخول، يرجى الاتصال بالمسؤول</p>
        </div>
      </div>
    </div>
  );
}

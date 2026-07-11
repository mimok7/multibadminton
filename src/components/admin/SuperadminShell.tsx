'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

const SYSTEM_MENU = [
  { label: '클럽 관리', href: '/superadmin/clubs', icon: '🏢' },
  { label: '클럽 회원', href: '/superadmin/members', icon: '👥' },
];

export default function SuperadminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const handleLogout = async () => {
    await getSupabaseClient().auth.signOut();
    window.location.href = '/login';
  };

  if (pathname === '/superadmin/login') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-slate-800 bg-slate-900 md:block">
        <div className="sticky top-0 flex min-h-screen flex-col">
          <div className="border-b border-slate-800 px-5 py-6">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-300">SYSTEM</div>
            <div className="mt-2 text-lg font-bold">슈퍼관리자</div>
            <p className="mt-1 text-xs text-slate-400">시스템 전체 관리</p>
          </div>
          <nav className="space-y-2 p-3">
            <div className="mb-3 px-3 text-xs font-bold uppercase tracking-[0.16em] text-slate-500">시스템 관리</div>
            {SYSTEM_MENU.map((item) => {
              const active = pathname === item.href || (item.href !== '/superadmin' && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${active ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-slate-800 p-4">
            <Link href="/" className="mb-2 block rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white">🏠 사용자 홈</Link>
            <button onClick={handleLogout} className="w-full rounded-lg bg-red-500/10 px-3 py-2 text-left text-sm font-semibold text-red-300 hover:bg-red-500/20">🚪 로그아웃</button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 bg-slate-50 text-slate-900">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 sm:px-8">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">SUPERADMIN</div>
            <div className="mt-1 text-sm font-semibold text-slate-700">시스템 전체 관리</div>
          </div>
          <div className="flex gap-2 md:hidden">
            <Link href="/superadmin/clubs" className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white">클럽 관리</Link>
            <button onClick={handleLogout} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600">로그아웃</button>
          </div>
        </header>
        <main className="min-h-[calc(100vh-73px)] p-4 sm:p-8">{children}</main>
      </div>
    </div>
  );
}

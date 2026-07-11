"use client";

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import { useUser } from '@/hooks/useUser';
import { getSupabaseClient } from '@/lib/supabase';
import { isAdminRole, isManagerRole } from '@/lib/auth';
import { SECTIONS } from './menuConfig';

function getGroupColors(color: string) {
  const colorMap: Record<string, { bg: string; border: string; text: string; active: string }> = {
    blue: { 
      bg: 'bg-blue-50', 
      border: 'border-l-4 border-blue-400', 
      text: 'text-blue-600',
      active: 'bg-blue-100 text-blue-800 border-l-4 border-blue-600'
    },
    green: { 
      bg: 'bg-green-50', 
      border: 'border-l-4 border-green-400', 
      text: 'text-green-600',
      active: 'bg-green-100 text-green-800 border-l-4 border-green-600'
    },
    purple: { 
      bg: 'bg-purple-50', 
      border: 'border-l-4 border-purple-400', 
      text: 'text-purple-600',
      active: 'bg-purple-100 text-purple-800 border-l-4 border-purple-600'
    },
    orange: { 
      bg: 'bg-orange-50', 
      border: 'border-l-4 border-orange-400', 
      text: 'text-orange-600',
      active: 'bg-orange-100 text-orange-800 border-l-4 border-orange-600'
    }
  };
  return colorMap[color] || colorMap.blue;
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile } = useUser();
  const [activeClubRole, setActiveClubRole] = useState<string | null>(null);
  const isGlobalAdmin = isAdminRole(profile?.role);
  const hasClubAdminAccess = ['owner', 'admin'].includes(activeClubRole || '');
  const isManagerMode = !isGlobalAdmin && ['owner', 'admin', 'manager'].includes(activeClubRole || '');
  const isSystemManager = isManagerRole(profile?.role);
  const homeHref = isGlobalAdmin ? '/superadmin' : isManagerMode || isSystemManager ? '/manager' : '/admin';
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const handleLogout = async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  };
  const [isDesktopSidebarVisible, setIsDesktopSidebarVisible] = useState(true);
  const [isMobileView, setIsMobileView] = useState(false);
  const [activeClubName, setActiveClubName] = useState<string>('');

  useEffect(() => {
    async function fetchActiveClub() {
      try {
        const res = await fetch('/api/user/active-club');
        const data = await res.json();
        if (data.club?.name) {
          setActiveClubName(data.club.name);
          document.title = `${data.club.name} - 매니저 대시보드`;
        }
        setActiveClubRole(data.clubRole || null);
      } catch (err) {
        console.error('Failed to fetch active club name:', err);
      }
    }
    fetchActiveClub();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(max-width: 768px)');

    const syncViewport = (matches: boolean) => {
      setIsMobileView(matches);
      if (!matches) {
        setIsMobileSidebarOpen(false);
      }
    };

    syncViewport(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      syncViewport(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const isActive = (href: string) => {
    try {
      const normalizedHref = href.split('?')[0];
      return pathname === normalizedHref || pathname?.startsWith(normalizedHref + '/');
    } catch {
      return false;
    }
  };

  const handleNavClick = () => {
    if (isMobileView) {
      setIsMobileSidebarOpen(false);
    }
  };

  const visibleSections = useMemo(() => {
    let sectionsCopy = JSON.parse(JSON.stringify(SECTIONS)) as typeof SECTIONS;

    if (!isGlobalAdmin && !hasClubAdminAccess) {
      return sectionsCopy.map(section => {
        return section.title === '🏸 경기 관리' || section.title === '🏆 대회 관리'
          ? section
          : { ...section, items: [] };
      });
    }
    
    return sectionsCopy;
  }, [hasClubAdminAccess, isGlobalAdmin, isManagerMode, isSystemManager]);

  const sidebarNav = (
    <nav className="p-3 space-y-2">
      {visibleSections.map((section) => {
        const colors = getGroupColors(section.color);
        return (
          <div key={section.title} className={`mb-5 rounded-xl ${colors.bg} p-3`}>
            <div className={`px-2 mb-2 text-sm font-bold uppercase tracking-[0.08em] ${colors.text}`}>
              {section.title}
            </div>
            <ul className="space-y-1">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={handleNavClick}
                    className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                      isActive(item.href)
                        ? colors.active
                        : 'text-gray-600 hover:bg-white hover:bg-opacity-50 hover:text-gray-900'
                    }`}
                  >
                    <span className="w-5 text-center text-sm">{item.icon ?? '•'}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

    </nav>
  );

  return (
      <div className={`admin-mobile-optimized min-h-screen bg-gray-50 ${!isMobileView && isDesktopSidebarVisible ? 'grid grid-cols-[13rem_minmax(0,1fr)]' : 'grid grid-cols-1'}`}>
        {!isMobileView && isDesktopSidebarVisible && (
          <aside className="sticky top-0 z-30 h-screen w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-white">
            <div className="border-b border-gray-100 p-4">
              <Link href={homeHref} className="block text-base font-bold text-gray-900 tracking-tight">
                {activeClubName ? `🏸 ${activeClubName}` : '⚙️ 관리자'}
              </Link>
              <div className="mt-1 text-xs text-gray-500">
                {activeClubName && <span className="block font-semibold text-indigo-600 mb-0.5">매니저 모드</span>}
                {profile?.full_name || profile?.username || '관리자'}님
              </div>
            </div>
            {sidebarNav}
          </aside>
        )}

        {isMobileView && isMobileSidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setIsMobileSidebarOpen(false)}>
            <aside
              className="absolute inset-y-0 left-0 w-72 max-w-[82vw] overflow-y-auto border-r border-gray-200 bg-white shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-gray-100 p-4">
                <div>
                  <Link href={homeHref} onClick={handleNavClick} className="block text-base font-bold text-gray-900 tracking-tight">
                    {activeClubName ? `🏸 ${activeClubName}` : '⚙️ 관리자'}
                  </Link>
                  <div className="mt-1 text-xs text-gray-500">
                    {activeClubName && <span className="block font-semibold text-indigo-600 mb-0.5">매니저 모드</span>}
                    {profile?.full_name || profile?.username || '관리자'}님
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMobileSidebarOpen(false)}
                  className="rounded border border-gray-300 px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  닫기
                </button>
              </div>
              {sidebarNav}
            </aside>
          </div>
        )}

        <div className="min-w-0 w-full">
          <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-3 py-3 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-[0.12em] text-gray-400 sm:text-sm">
                  {activeClubName ? `🏸 ${activeClubName}` : 'ADMIN'}
                </div>
                <div className="truncate text-sm font-semibold text-gray-900 sm:hidden">
                  {activeClubName ? '관리자 영역' : (profile?.full_name || profile?.username || '관리자')}
                </div>
                <div className="hidden text-sm text-gray-500 sm:block">
                  {activeClubName ? `${activeClubName} 관리자 영역` : '관리자 영역'}
                </div>
              </div>
              <div className="flex gap-1.5 sm:gap-2">
                <Link
                  href={homeHref}
                  className="inline-flex items-center rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs sm:text-sm font-medium text-gray-700 hover:bg-gray-100 sm:px-3"
                >
                  {!isGlobalAdmin && (isManagerMode || isSystemManager) ? '⚙️ 매니저 홈' : '⚙️ 관리자 홈'}
                </Link>
                <Link
                  href="/"
                  className="inline-flex items-center rounded border border-gray-300 bg-white px-2.5 py-1.5 text-xs sm:text-sm font-medium text-gray-700 hover:bg-gray-100 sm:px-3"
                >
                  🏠 사용자 홈
                </Link>
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs sm:text-sm font-medium text-red-700 hover:bg-red-100 sm:px-3"
                >
                  🚪 로그아웃
                </button>
                {isMobileView ? (
                  <button
                    type="button"
                    onClick={() => setIsMobileSidebarOpen(true)}
                    className="rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    메뉴
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsDesktopSidebarVisible((prev) => !prev)}
                    className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  >
                    {isDesktopSidebarVisible ? '사이드바 숨기기' : '사이드바 표시'}
                  </button>
                )}
              </div>
            </div>
          </header>
          <main className={`admin-mobile-content relative z-0 min-h-screen w-full bg-gray-50 ${isMobileView ? 'px-2 py-2 pb-3' : 'px-6 py-6'}`}>
            {children}
          </main>
        </div>
      </div>
  );
}

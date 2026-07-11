'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/useUser';
import { useClub } from '@/hooks/useClub';

export default function ManagerDashboardPage() {
  const { profile, loading } = useUser();
  const { clubName } = useClub();
  const router = useRouter();

  const [isMobile, setIsMobile] = useState(true);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (!loading) {
      if (!isMobile) {
        router.replace('/match-schedule');
      }
    }
  }, [loading, router, isMobile]);

  return (
    <div className="px-1 py-2 sm:px-2">
      <section className="rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
        <div className="flex items-start justify-between gap-3 px-2">
          <div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold leading-tight">
                {clubName ? `🏸 ${clubName} 매니저 대시보드` : '⚙️ 매니저 대시보드'}
              </h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-slate-100">
                안녕하세요, {profile?.full_name || profile?.username || '매니저'}님
              </span>
            </div>
          </div>
          <Link href="/dashboard">
            <button className="shrink-0 rounded-full bg-white/10 px-3 py-2 text-xs font-bold text-white transition hover:bg-white/20 border-0 flex items-center gap-1.5">
              <span>🏠</span>
              <span>사용자 홈</span>
            </button>
          </Link>
        </div>
      </section>

      <div>
        <h2 className="mb-3 text-base font-medium text-gray-900 sm:mb-4 sm:text-lg">빠른 액션</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
          <Link
            href="/players"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-blue-400 hover:bg-blue-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">⚡ 오늘경기</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">오늘 경기 생성과 배정을 진행하세요</p>
          </Link>

          <Link
            href="/match-results"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-green-400 hover:bg-green-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">🏆 경기결과</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">경기 결과를 입력하고 확인하세요</p>
          </Link>

          <Link
            href="/team-management"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-orange-400 hover:bg-orange-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">🤝 팀관리</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">대회용 팀을 구성하고 관리하세요</p>
          </Link>

          <Link
            href="/manager/tournament-matches"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-amber-400 hover:bg-amber-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">🎪 대회 경기</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">대회를 생성하고 경기 일정을 관리하세요</p>
          </Link>

          <Link
            href="/manager/pair-tournament-settings"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-yellow-400 hover:bg-yellow-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">👥 페어 대회</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">페어전 전용 설정으로 그룹별 대회를 생성하세요</p>
          </Link>

          <Link
            href="/manager/tournament-bracket"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-indigo-400 hover:bg-indigo-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">📊 대진표</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">대진표와 결과 현황을 확인하세요</p>
          </Link>

          <Link
            href="/manager/notifications"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-pink-400 hover:bg-pink-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">📢 공지사항</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">클럽의 공지사항을 등록하고 관리하세요</p>
          </Link>

          <Link
            href="/members"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-purple-400 hover:bg-purple-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">👥 클럽 회원관리</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">클럽 회원 정보와 권한을 관리하세요</p>
          </Link>

          <Link
            href="/manager/admin"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-rose-400 hover:bg-rose-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">🏢 전체 클럽 관리</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">시스템에 등록된 전체 클럽을 관리하세요</p>
          </Link>

          <Link
            href="/manager/admin/members"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-fuchsia-400 hover:bg-fuchsia-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">👥 전체 사용자 관리</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">시스템에 등록된 전체 사용자의 권한과 정보를 관리하세요</p>
          </Link>

          <Link
            href="/manager/manual"
            className="rounded-lg border border-blue-200 bg-white px-3 py-3 transition-colors hover:border-sky-400 hover:bg-sky-50 sm:p-4 shadow-sm"
          >
            <h3 className="text-sm font-medium text-gray-900 sm:text-base">📖 사용설명서</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500 sm:text-sm">시스템 기능과 관리 이용 안내서를 확인하세요</p>
          </Link>
        </div>
      </div>
    </div>
  );
}

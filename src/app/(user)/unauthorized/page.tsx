'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { useLevelInfoMap } from '@/hooks/useLevelInfoMap';
import { getLevelNameFromCode } from '@/lib/level-info';
import { isSuperadminProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function UnauthorizedPage() {
  const { user, profile, isAdmin } = useUser();
  const levelInfoMap = useLevelInfoMap();
  const [clubRole, setClubRole] = useState<string | null>(null);
  const isSuperadmin = isSuperadminProfile(profile);

  useEffect(() => {
    if (user) {
      fetch('/api/user/active-club')
        .then((res) => res.json())
        .then((data) => {
          if (data.clubRole) {
            setClubRole(data.clubRole);
          }
        })
        .catch((err) => console.error('Failed to fetch club role in unauthorized page:', err));
    }
  }, [user]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f7fb] p-4">
      <div className="max-w-md w-full bg-white rounded-[24px] border border-slate-200/80 p-8 text-center shadow-sm">
        <div className="mb-6">
          <div className="mx-auto w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-rose-500" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">접근 권한이 없습니다</h1>
          <p className="text-xs text-slate-500 leading-relaxed">
            이 페이지에 접근하려면 관리자 권한이 필요합니다.
          </p>
        </div>

        {/* 사용자 정보 표시 */}
        {user && profile && (
          <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 mb-6 text-left">
            <h3 className="font-semibold text-slate-800 text-xs mb-2">현재 로그인 정보</h3>
            <div className="text-xs text-slate-600 space-y-1.5">
              <p><span className="font-medium text-slate-400">사용자:</span> {profile.full_name || profile.username || '이름 없음'}</p>
              <p>
                <span className="font-medium text-slate-400">권한:</span>{' '}
                {isSuperadmin
                  ? '슈퍼관리자'
                  : isAdmin
                  ? '관리자'
                  : clubRole === 'owner'
                  ? '클럽 소유자'
                  : clubRole === 'admin'
                  ? '클럽 관리자'
                  : clubRole === 'manager'
                  ? '매니저'
                  : '일반 사용자'}
              </p>
              <p><span className="font-medium text-slate-400">레벨:</span> {profile.skill_level_name || getLevelNameFromCode(levelInfoMap, profile.skill_level, profile.skill_level || '미지정')}</p>
            </div>
          </div>
        )}

        {!user && (
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-6">
            <p className="text-amber-800 text-xs">
              로그인이 필요합니다. 먼저 로그인해주세요.
            </p>
          </div>
        )}

        {/* 행동 버튼들 */}
        <div className="flex flex-col gap-2">
          <Link href="/dashboard" className="w-full">
            <Button
              className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs"
            >
              대시보드로 이동
            </Button>
          </Link>
          
          {!user && (
            <Link href="/login" className="w-full">
              <Button 
                variant="outline"
                className="w-full h-11 rounded-xl border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs bg-white"
              >
                로그인하기
              </Button>
            </Link>
          )}

          <Link href="/" className="w-full">
            <Button 
              variant="outline"
              className="w-full h-11 rounded-xl border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-xs bg-white"
            >
              홈으로 이동
            </Button>
          </Link>
        </div>

        {/* 관리자 권한 요청 안내 */}
        {user && !isAdmin && (
          <div className="mt-6 p-4 bg-indigo-50/50 border border-indigo-100/60 rounded-xl">
            <p className="text-indigo-900 text-xs leading-relaxed">
              <strong>관리자 권한이 필요하신가요?</strong><br />
              클럽 관리자에게 문의하여 권한 승급을 요청하세요.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { setActiveClubAction } from '@/app/actions/club';
import { invalidateClubCache } from '@/hooks/useClub';

type Club = {
  club_id: string;
  role: string;
  status: string;
  clubs: {
    id: string;
    name: string;
    code: string;
  } | null;
};

export default function ClubSelectorClient({ 
  clubs, 
  isGlobalAdmin = false 
}: { 
  clubs: Club[];
  isGlobalAdmin?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') || '/';
  const [loading, setLoading] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSelect = async (clubId: string) => {
    setLoading(clubId);
    setErrorMessage(null);
    try {
      const result = await setActiveClubAction(clubId);
      if (!result.success) {
        setErrorMessage(result.error || '클럽을 선택하지 못했습니다.');
        setLoading(null);
        return;
      }
      invalidateClubCache();
      router.push(redirectTo);
    } catch (error) {
      console.error('Failed to set club:', error);
      setErrorMessage('클럽을 선택하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      setLoading(null);
    }
  };

  if (clubs.length === 0) {
    if (isGlobalAdmin) {
      return (
        <div className="text-center p-8 bg-slate-800 rounded-xl border border-slate-700">
          <h2 className="text-xl font-bold mb-4 text-white">등록된 클럽이 없습니다</h2>
          <p className="text-slate-400 mb-6">시스템에 등록된 클럽이 없습니다. 전체 관리자 대시보드로 이동하여 클럽을 생성하세요.</p>
          <Button variant="default" className="w-full mb-2 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => router.push('/manager/admin')}>
            전체 관리자 대시보드로 이동
          </Button>
          <Button variant="outline" className="w-full" onClick={() => router.push('/login')}>
            로그인 페이지로 돌아가기
          </Button>
        </div>
      );
    }

    return (
      <div className="text-center p-8 bg-slate-800 rounded-xl border border-slate-700">
        <h2 className="text-xl font-bold mb-4 text-white">가입된 클럽이 없습니다</h2>
        <p className="text-slate-400 mb-6">초대 코드를 통해 클럽에 가입하거나 관리자에게 문의하세요.</p>
        <Button variant="outline" onClick={() => router.push('/login')}>
          로그인 페이지로 돌아가기
        </Button>
      </div>
    );
  }

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'owner':
        return '소유자';
      case 'admin':
        return '관리자';
      case 'manager':
        return '매니저';
      default:
        return '일반 회원';
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-center text-white mb-6">입장할 클럽을 선택하세요</h2>
      {errorMessage && (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </p>
      )}
      {isGlobalAdmin && (
        <Button 
          variant="outline" 
          className="w-full py-6 text-lg border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10 text-emerald-400"
          onClick={() => router.push('/manager/admin')}
        >
          클럽 선택 없이 전체 관리자 대시보드 입장
        </Button>
      )}
      <div className="grid gap-4">
        {clubs.map((c) => {
          const club = Array.isArray(c.clubs) ? c.clubs[0] : c.clubs;
          if (!club) return null;
          
          return (
            <Button
              key={club.id}
              type="button"
              variant="ghost"
              onClick={() => handleSelect(club.id)}
              disabled={loading !== null}
              className={`h-auto min-h-10 w-full p-6 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-all text-left flex items-center justify-between group ${
                loading === club.id ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              <div>
                <h3 className="text-xl font-bold text-emerald-400 group-hover:text-emerald-300 transition-colors">
                  {club.name}
                </h3>
                <p className="text-sm text-slate-400 mt-1">권한: {getRoleLabel(c.role)}</p>
              </div>
              <div className="text-slate-500 group-hover:text-emerald-400 transition-colors">
                {loading === club.id ? (
                  <span className="animate-spin inline-block w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
                ) : (
                  '입장하기 →'
                )}
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

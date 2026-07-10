'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import { isAdminOrManagerRole } from '@/lib/auth';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAuth?: boolean;
  requireAdmin?: boolean;
  redirectTo?: string;
}

const CLUB_ROLE_TIMEOUT_MS = 5000;

export default function AuthGuard({ 
  children, 
  requireAuth = false, 
  requireAdmin = false,
  redirectTo = '/login'
}: AuthGuardProps) {
  const { user, profile, loading: userLoading, isAdmin } = useUser();
  const router = useRouter();
  
  const [clubRole, setClubRole] = useState<string | null>(null);
  const [isCheckingClub, setIsCheckingClub] = useState(false);
  const [hasCheckedClub, setHasCheckedClub] = useState(false);

  const userId = user?.id;
  const isGlobalSuperUser = isAdmin || isAdminOrManagerRole(profile?.role);
  
  // 클럽 권한 확인이 필요한 경우인지 판단
  const needsClubCheck = requireAdmin && !!userId && !isGlobalSuperUser && !hasCheckedClub;

  useEffect(() => {
    // 관리자 권한이 필요하지만 글로벌 관리자가 아닌 경우 클럽 내 역할 확인
    if (needsClubCheck && !isCheckingClub) {
      let isMounted = true;
      setIsCheckingClub(true);

      const timeoutId = window.setTimeout(() => {
        if (isMounted) {
          setClubRole('timeout');
          setIsCheckingClub(false);
          setHasCheckedClub(true);
        }
      }, CLUB_ROLE_TIMEOUT_MS);

      fetch('/api/user/active-club')
        .then(res => res.json())
        .then(data => {
          window.clearTimeout(timeoutId);
          if (isMounted) {
            setClubRole(data.clubRole || 'none');
            setIsCheckingClub(false);
            setHasCheckedClub(true);
          }
        })
        .catch(err => {
          window.clearTimeout(timeoutId);
          console.error('Error fetching club role in AuthGuard:', err);
          if (isMounted) {
            setClubRole('error');
            setIsCheckingClub(false);
            setHasCheckedClub(true);
          }
        });
        
      return () => {
        isMounted = false;
        window.clearTimeout(timeoutId);
        // React StrictMode remount fix
        setIsCheckingClub(false);
      };
    }
  }, [needsClubCheck, isCheckingClub]);

  // 유저 정보 로딩 중이거나, 클럽 권한 확인이 필요한데 아직 확인 중/전인 경우 로딩 상태로 간주
  const loading = userLoading || isCheckingClub || needsClubCheck;
  
  const isClubManager = clubRole === 'manager' || clubRole === 'admin' || clubRole === 'owner';
  const canAccessAdmin = isGlobalSuperUser || isClubManager;

  useEffect(() => {
    if (loading) return;

    // 인증이 필요한 페이지인데 로그인하지 않은 경우
    if (requireAuth && !user) {
      router.replace(redirectTo);
      return;
    }

    // 관리자 권한이 필요한 페이지인데 관리자가 아닌 경우
    if (requireAdmin && (!userId || !canAccessAdmin)) {
      console.log('[AuthGuard] Redirecting to /unauthorized!', { requireAdmin, userId, canAccessAdmin, clubRole, isGlobalSuperUser, isClubManager, isCheckingClub, hasCheckedClub, loading });
      router.replace('/unauthorized');
      return;
    }
  }, [userId, loading, canAccessAdmin, requireAuth, requireAdmin, router, redirectTo, user, clubRole, isGlobalSuperUser, isClubManager, isCheckingClub, hasCheckedClub]);

  // 로딩 중일 때
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          <p className="text-gray-600">사용자 권한 확인 중...</p>
        </div>
      </div>
    );
  }

  // 인증이 필요한데 로그인하지 않은 경우
  if (requireAuth && !user) {
    return null; // 리다이렉트 중이므로 아무것도 렌더링하지 않음
  }

  // 관리자 권한이 필요한인데 관리자가 아닌 경우
  if (requireAdmin && (!userId || !canAccessAdmin)) {
    return null; // 리다이렉트 중이므로 아무것도 렌더링하지 않음
  }

  return <>{children}</>;
}

// 로그인이 필요한 페이지 래퍼
export function RequireAuth({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requireAuth={true}>
      {children}
    </AuthGuard>
  );
}

// 관리자 권한이 필요한 페이지 래퍼
export function RequireAdmin({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requireAuth={true} requireAdmin={true}>
      {children}
    </AuthGuard>
  );
}

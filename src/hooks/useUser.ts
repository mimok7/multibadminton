'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase';
import { type AppProfile, getRoleFromUser, isAdminOrManagerRole } from '@/lib/auth';
import { fetchProfileServer } from '@/app/actions/profile';

type Profile = AppProfile;

// 캐시된 프로필 데이터
let cachedProfile: Profile | null = null;
let cachedUserId: string | null = null;
let cachedUser: User | null = null;
let hasResolvedAuth = false;
let pendingProfileRequest: { userId: string; promise: Promise<Profile | null> } | null = null;
// 여러 전역 컴포넌트(Header, 알림, 페이지)가 동시에 useUser()를 호출해도
// 최초 세션 조회는 한 번만 수행합니다.
let initialSessionPromise: Promise<Awaited<ReturnType<ReturnType<typeof getSupabaseClient>['auth']['getSession']>>> | null = null;

const AUTH_TIMEOUT_MS = 10000;

function withTimeout<T>(promise: Promise<T>, timeoutMs = AUTH_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Auth request timed out'));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function getInitialSession(supabase: ReturnType<typeof getSupabaseClient>) {
  if (!initialSessionPromise) {
    initialSessionPromise = supabase.auth.getSession();
  }
  return initialSessionPromise;
}

export function useUser() {
  const [user, setUser] = useState<User | null>(cachedUser);
  const [profile, setProfile] = useState<Profile | null>(cachedProfile);
  const [loading, setLoading] = useState(!hasResolvedAuth);
  const supabase = useMemo(() => getSupabaseClient(), []);

  const fetchProfile = useCallback(async (userId: string) => {
    // 캐시된 프로필이 같은 사용자의 것이면 재사용
    if (cachedProfile && cachedUserId === userId) {
      setProfile(cachedProfile);
      return cachedProfile;
    }

    const profilePromise = pendingProfileRequest?.userId === userId
      ? pendingProfileRequest.promise
      : fetchProfileServer(userId);

    if (!pendingProfileRequest || pendingProfileRequest.userId !== userId) {
      pendingProfileRequest = { userId, promise: profilePromise };
    }

    try {
      const profile = await profilePromise;

      // 로그아웃 또는 사용자 전환 중 완료된 이전 요청은 캐시에 반영하지 않습니다.
      if (cachedUser?.id !== userId) {
        return null;
      }
      
      if (profile) {
        cachedProfile = profile;
        cachedUserId = userId;
        setProfile(profile);
        return profile;
      }

      setProfile(null);
    } catch (error) {
      console.error('Profile fetch error:', error);
      setProfile(null);
    } finally {
      if (pendingProfileRequest?.promise === profilePromise) {
        pendingProfileRequest = null;
      }
    }
    
    return null;
  }, [supabase]);

  useEffect(() => {
    let isMounted = true;
    const deferredAuthUpdates = new Set<number>();

    const applySession = async (session: Session | null, errorLabel: string) => {
      if (!isMounted) return;

      const sessionUser = session?.user ?? null;
      cachedUser = sessionUser;
      hasResolvedAuth = true;
      setUser(sessionUser);

      if (sessionUser) {
        try {
          await withTimeout(fetchProfile(sessionUser.id));
        } catch (error) {
          console.error(errorLabel, error);
        }
      } else {
        setProfile(null);
        cachedProfile = null;
        cachedUserId = null;
        pendingProfileRequest = null;
      }

      if (isMounted) setLoading(false);
    };

    const getUser = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await withTimeout(getInitialSession(supabase));
        
        if (!isMounted) return;

        if (sessionError) {
          console.error('Session fetch error:', sessionError);
        }

        await applySession(session, 'Initial profile fetch error:');
      } catch (error) {
        console.error('User fetch error:', error);
        cachedUser = null;
        hasResolvedAuth = true;
        setUser(null);
        setProfile(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        // 로그인/로그아웃 이후 새로 마운트되는 컴포넌트는 최신 세션을 읽어야 합니다.
        initialSessionPromise = null;
        // Supabase Auth 내부 잠금이 해제된 뒤 프로필 쿼리를 실행해야 교착 상태가 발생하지 않습니다.
        const timeoutId = window.setTimeout(() => {
          deferredAuthUpdates.delete(timeoutId);
          void applySession(session, 'Auth state profile fetch error:');
        }, 0);
        deferredAuthUpdates.add(timeoutId);
      }
    );

    return () => {
      isMounted = false;
      deferredAuthUpdates.forEach((timeoutId) => window.clearTimeout(timeoutId));
      deferredAuthUpdates.clear();
      subscription.unsubscribe();
    };
  }, [supabase, fetchProfile]);

  // 파생 상태: 관리자 여부 (메모이제이션)
  const isAdmin = useMemo(
    () => isAdminOrManagerRole(profile?.role) || isAdminOrManagerRole(getRoleFromUser(user)),
    [profile?.role, user]
  );

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    cachedProfile = null;
    cachedUserId = null;
    await fetchProfile(user.id);
  }, [user, fetchProfile]);

  return { user, profile, loading, isAdmin, refreshProfile };
}

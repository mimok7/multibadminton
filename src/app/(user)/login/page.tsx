'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import Image from 'next/image';
import { getSupabaseClient } from '@/lib/supabase';
import { DEFAULT_USER_REDIRECT, isSafeRedirectPath } from '@/lib/route-access';
import { clearActiveClubAction } from '@/app/actions/club';
import { useRouter } from 'next/navigation';

export const dynamic = 'force-dynamic';

const INITIAL_TEMP_PASSWORD = 'bad123!';

type ProfileMatch = {
  id: string;
  fullName: string;
  email: string;
  username: string;
  hasLinkedUser: boolean;
  clubs: Array<{ id: string; name: string }>;
};

export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    // 로그인 화면에 진입하면 이전의 활성화 클럽 쿠키를 확실하게 삭제
    clearActiveClubAction().catch((err) => console.error('Failed to clear active club:', err));
  }, []);

  const supabase = getSupabaseClient();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [autoFillMessage, setAutoFillMessage] = useState('');
  const [foundClubs, setFoundClubs] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
 
  // For homonym selection
  const [matchedProfiles, setMatchedProfiles] = useState<ProfileMatch[]>([]);
  const [showClubModal, setShowClubModal] = useState(false);
 
  const debugEnabled = process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS === 'true';
  const shouldRequirePasswordChange = (value: unknown) => value === true || value === 'true';
 
  const findProfilesByName = async (value: string, signal?: AbortSignal) => {
    const trimmedValue = value.trim();
    if (!trimmedValue) return null;
 
    const response = await fetch(`/api/auth/profile-email?fullName=${encodeURIComponent(trimmedValue)}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    });
 
    if (response.status === 404) return [];
 
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'Profile lookup failed');
    }
 
    const payload = await response.json();
    return payload.profiles as ProfileMatch[];
  };
 
  const getLoginErrorMessage = (message?: string) => {
    const normalized = message?.toLowerCase() ?? '';
    if (normalized.includes('invalid login credentials')) return '아이디 또는 비밀번호가 올바르지 않습니다.';
    if (normalized.includes('email rate limit exceeded')) return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
    return message || '로그인 중 오류가 발생했습니다.';
  };
 
  const handleNameSearch = async () => {
    const trimmedFullName = fullName.trim();
    setError('');
    setMatchedProfiles([]);
    setShowClubModal(false);
    setFoundClubs('');
 
    if (!trimmedFullName) {
      setAutoFillMessage('한글 이름을 입력해주세요.');
      setEmail('');
      return;
    }
 
    try {
      setLookupLoading(true);
      const profiles = await findProfilesByName(trimmedFullName);
 
      if (!profiles || profiles.length === 0) {
        setEmail('');
        setAutoFillMessage('등록된 한글 이름을 찾지 못했습니다.');
      } else if (profiles.length === 1) {
        const p = profiles[0];
        setEmail(p.email);
        setAutoFillMessage(`✓ 계정을 찾았습니다. (초기 비밀번호: bad123!)`);
        const clubNames = p.clubs && p.clubs.length > 0
          ? p.clubs.map(c => c.name).join(', ')
          : '소속 클럽 없음';
        setFoundClubs(clubNames);
      } else {
        // Multiple profiles found
        setMatchedProfiles(profiles);
        setShowClubModal(true);
        setAutoFillMessage('동명이인이 있습니다. 클럽을 선택해주세요.');
      }
    } catch (err) {
      setEmail('');
      const message = err instanceof Error ? err.message : undefined;
      setAutoFillMessage(message || '이메일 조회 중 문제가 발생했습니다.');
    } finally {
      setLookupLoading(false);
    }
  };
 
  const handleSelectProfile = (profile: ProfileMatch) => {
    setEmail(profile.email);
    setShowClubModal(false);
    setAutoFillMessage(`✓ 계정을 찾았습니다. (초기 비밀번호: bad123!)`);
    const clubNames = profile.clubs && profile.clubs.length > 0
      ? profile.clubs.map(c => c.name).join(', ')
      : '소속 클럽 없음';
    setFoundClubs(clubNames);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError('');

    try {
      const trimmedFullName = fullName.trim();
      const trimmedPassword = password.trim();

      if (!trimmedFullName) {
        setError('한글 이름을 입력해주세요.');
        return;
      }
      if (!trimmedPassword) {
        setError('비밀번호를 입력해주세요.');
        return;
      }

      let resolvedEmail = email.trim().toLowerCase();

      if (!resolvedEmail) {
        // Auto-lookup fallback
        const profiles = await findProfilesByName(trimmedFullName);
        if (!profiles || profiles.length === 0) {
          setError('입력한 한글 이름에 연결된 계정을 찾을 수 없습니다.');
          return;
        }
        if (profiles.length > 1) {
          setError('동명이인이 있습니다. [검색] 버튼을 눌러 소속 클럽을 선택해주세요.');
          return;
        }
        resolvedEmail = profiles[0].email.trim().toLowerCase();
        setEmail(resolvedEmail);
      }

      const { data: signInData, error: loginError } = await supabase.auth.signInWithPassword({
        email: resolvedEmail,
        password: trimmedPassword
      });

      if (loginError) {
        setError(getLoginErrorMessage(loginError.message));
        return;
      }

      let mustChangePassword = shouldRequirePasswordChange(
        signInData.user?.user_metadata?.must_change_password ??
        signInData.session?.user?.user_metadata?.must_change_password
      );

      if (mustChangePassword && trimmedPassword !== INITIAL_TEMP_PASSWORD) {
        await supabase.auth.updateUser({
          data: {
            ...(signInData.user?.user_metadata || signInData.session?.user?.user_metadata || {}),
            must_change_password: false,
          },
        });
        await supabase.auth.refreshSession();
        mustChangePassword = false;
      }

      const role = signInData.user?.app_metadata?.role || signInData.user?.user_metadata?.role;
      const isAdmin = role === 'admin' || role === 'administrator' || role === '관리자';
      const isManager = role === 'manager' || role === '매니저' || role === '운영자';
      
      // 사용자 클럽 목록 조회 및 active_club_id 쿠키 자동 갱신 (서버사이드 처리)
      if (signInData.user) {
        try {
          await fetch('/api/user/auto-select-club', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${signInData.session?.access_token}`,
            },
          });
        } catch (e) {
          console.error('Failed to auto-select club:', e);
        }
      }

      let defaultPath = DEFAULT_USER_REDIRECT;
      if (isAdmin) defaultPath = '/admin';
      else if (isManager) defaultPath = '/manager';

      let nextPath = mustChangePassword ? '/change-password' : defaultPath;

      const redirectTo = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('redirectTo') : null;
      if (redirectTo && isSafeRedirectPath(redirectTo)) {
        nextPath = redirectTo;
      }

      // Next.js App Router 환경에서 쿠키 동기화 시간을 위해 살짝 대기 후 라우팅
      setTimeout(() => {
        router.refresh();
        router.push(nextPath);
      }, 300);

    } catch (error) {
      setError('로그인 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f7fb] p-4">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center">
          <div className="mb-5 flex justify-center">
            <div className="rounded-[2rem] bg-white p-4 shadow-sm ring-1 ring-slate-100/60">
              <Image
                src="/maintenance_badminton.png"
                alt="배드민턴 로고"
                width={128}
                height={128}
                className="h-28 w-28 object-contain sm:h-32 sm:w-32"
                priority
              />
            </div>
          </div>
          <h2 className="text-3xl font-extrabold text-slate-900">
            배드민턴 클럽 시스템
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            매니저가 등록한 한글 이름으로 간편하게 로그인하세요!
          </p>
        </div>

        <div className="bg-white rounded-[24px] border border-slate-200/80 p-6 shadow-sm">
          <form className="space-y-4" onSubmit={handleLogin}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-xs">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="fullName" className="text-sm font-medium text-slate-700">
                한글 이름
              </label>
              <div className="flex gap-2">
                <Input
                  id="fullName"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    setEmail('');
                    setError('');
                    setAutoFillMessage('');
                    setFoundClubs('');
                  }}
                  placeholder="예: 김진호"
                  className="w-full h-12 rounded-xl"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleNameSearch}
                  disabled={lookupLoading}
                  className="shrink-0 h-12 rounded-xl border-slate-200 bg-white hover:bg-slate-50 font-semibold px-4 text-xs"
                >
                  {lookupLoading ? '검색 중...' : '계정 검색'}
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                이름 입력 후 [계정 검색] 버튼을 눌러 본인 확인을 진행해주세요.
              </p>
              {autoFillMessage && (
                <p className={`text-[11px] font-semibold ${autoFillMessage.startsWith('✓') ? 'text-green-600' : 'text-amber-600'}`}>
                  {autoFillMessage}
                </p>
              )}
              {foundClubs && (
                <p className="text-[11px] font-semibold text-indigo-600 mt-1">
                  소속 클럽: {foundClubs}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium text-slate-700">
                비밀번호
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="최초 로그인 비밀번호: bad123!"
                className="w-full h-12 rounded-xl"
              />
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 font-semibold shadow-lg shadow-indigo-600/10"
              >
                {loading ? '로그인 중...' : '로그인'}
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* Homonym Club Selection Modal */}
      {showClubModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-[24px] border border-slate-200/80 p-6 shadow-2xl max-w-sm w-full space-y-4 relative animate-in fade-in zoom-in duration-200">
            <div className="text-center">
              <h3 className="text-xl font-bold text-slate-900">클럽 선택</h3>
              <p className="text-xs text-slate-500 mt-1">
                &apos;{fullName}&apos; 이름으로 가입된 여러 계정이 발견되었습니다.<br/>
                본인이 속한 클럽을 선택해주세요.
              </p>
            </div>

            <div className="space-y-2 mt-4 max-h-60 overflow-y-auto">
              {matchedProfiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => handleSelectProfile(profile)}
                  className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 transition-colors"
                >
                  <div className="font-semibold text-slate-900 text-sm">
                    {profile.clubs.length > 0
                      ? profile.clubs.map(c => c.name).join(', ')
                      : '소속 클럽 없음'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {profile.username && `닉네임: ${profile.username}`}
                  </div>
                </button>
              ))}
            </div>

            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowClubModal(false)}
                className="w-full h-11 rounded-xl border-slate-200 hover:bg-slate-50 text-slate-600 font-semibold text-sm"
              >
                취소
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

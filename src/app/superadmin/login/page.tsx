'use client';

import Image from 'next/image';
import { FormEvent, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';

export default function SuperadminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('이메일과 비밀번호를 입력해 주세요.');
      return;
    }

    setIsSubmitting(true);
    const { error: signInError } = await getSupabaseClient().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setIsSubmitting(false);
      setError('슈퍼관리자 이메일 또는 비밀번호가 올바르지 않습니다.');
      return;
    }

    window.location.assign('/superadmin');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex size-20 items-center justify-center rounded-2xl bg-white shadow-lg">
            <Image src="/badminton.png" alt="배드민턴" width={64} height={64} className="object-contain" />
          </div>
          <div className="mt-6 text-xs font-bold uppercase tracking-[0.22em] text-indigo-300">SUPERADMIN LOGIN</div>
          <h1 className="mt-2 text-2xl font-black text-white">슈퍼관리자 로그인</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">시스템 전체 관리자는 별도 이메일 로그인으로 접근합니다.</p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="superadmin-email" className="mb-2 block text-sm font-semibold text-slate-200">이메일</label>
            <input
              id="superadmin-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="superadmin@example.com"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30"
            />
          </div>
          <div>
            <label htmlFor="superadmin-password" className="mb-2 block text-sm font-semibold text-slate-200">비밀번호</label>
            <input
              id="superadmin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="비밀번호를 입력하세요"
              className="w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30"
            />
          </div>
          {error && <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? '로그인 중...' : '슈퍼관리자 로그인'}
          </button>
        </form>

        <a href="/login" className="mt-6 block text-center text-sm font-semibold text-slate-400 hover:text-white">일반 로그인으로 이동</a>
      </div>
    </div>
  );
}

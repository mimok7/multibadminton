'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const LEVELS = ['N3', 'N2', 'N1', 'E3', 'E2', 'E1', 'D3', 'D2', 'D1', 'C3', 'C2', 'C1', 'B3', 'B2', 'B1', 'A3', 'A2', 'A1'];

export default function ManagerGuestPage() {
  const [fullName, setFullName] = useState('');
  const [skillLevel, setSkillLevel] = useState('N3');
  const [levels, setLevels] = useState<Array<{ code: string; label: string }>>(
    LEVELS.map((code) => ({ code, label: code }))
  );
  const [gender, setGender] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  useEffect(() => {
    fetch('/api/admin/guests', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(payload?.levels)) return;
        setLevels(payload.levels);
        if (payload.levels.some((level: { code: string }) => level.code === 'N3')) setSkillLevel('N3');
        else if (payload.levels[0]?.code) setSkillLevel(payload.levels[0].code);
      })
      .catch(() => undefined);
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (submitting) return;
    setSubmitting(true); setMessage(null);
    try {
      const response = await fetch('/api/admin/guests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName, skillLevel, gender }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || '게스트 추가에 실패했습니다.');
      setMessage({ type: 'success', text: `${payload.guest.fullName} 게스트를 추가했습니다. 초기 비밀번호는 ${payload.guest.initialPassword}이며, 첫 로그인 후 변경해야 합니다.` });
      setFullName(''); setSkillLevel('N3'); setGender('');
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : '게스트 추가에 실패했습니다.' }); }
    finally { setSubmitting(false); }
  };
  return <div className="mx-auto w-full max-w-xl px-2.5 pb-4 pt-0 sm:px-5">
    <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]"><div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)]" /><div className="relative z-10 flex items-center justify-between px-1"><div className="space-y-0.5 pl-2"><span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300"><UserPlus className="h-3.5 w-3.5" />게스트 관리</span><h1 className="text-xl font-bold tracking-tight">게스트 추가</h1><p className="mt-0.5 hidden text-xs text-slate-400 sm:block">현재 클럽에만 게스트 회원을 생성합니다.</p></div><Link href="/manager"><Button variant="outline" className="flex items-center gap-1.5 rounded-full border-0 bg-white/10 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/15"><ArrowLeft className="h-3.5 w-3.5" />홈</Button></Link></div></section>
    <form onSubmit={submit} className="mt-3 rounded-[24px] bg-white px-3 py-3 shadow-sm sm:p-5"><p className="mb-4 text-sm text-slate-600">생성된 게스트는 현재 클럽의 <strong>guest</strong> 권한으로 등록됩니다. 경기 참가가 필요하면 경기 일정에서 추가해 주세요.</p><div className="space-y-3"><label className="block text-sm font-medium text-slate-700">이름<input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} disabled={submitting} className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 px-3 text-sm" placeholder="게스트 이름" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm font-medium text-slate-700">레벨<select value={skillLevel} onChange={(event) => setSkillLevel(event.target.value)} disabled={submitting} className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">{levels.map((level) => <option key={level.code} value={level.code}>{level.label}</option>)}</select></label><label className="block text-sm font-medium text-slate-700">성별<select value={gender} onChange={(event) => setGender(event.target.value)} disabled={submitting} className="mt-1.5 h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"><option value="">미지정</option><option value="M">남성</option><option value="F">여성</option><option value="O">기타</option></select></label></div><Button type="submit" disabled={submitting} className="h-11 w-full rounded-lg">{submitting ? '게스트 추가 중...' : '게스트 추가'}</Button></div>{message && <p className={`mt-4 rounded-lg p-3 text-sm ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>{message.text}</p>}</form>
  </div>;
}

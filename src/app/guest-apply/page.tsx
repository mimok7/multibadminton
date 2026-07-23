'use client';

import { FormEvent, useEffect, useState } from 'react';

type GuestSchedule = {
  id: string;
  match_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  description: string | null;
  max_participants: number | null;
  current_participants: number | null;
};

export default function GuestApplyPage() {
  const [clubCode, setClubCode] = useState('');
  const [clubName, setClubName] = useState('');
  const [schedules, setSchedules] = useState<GuestSchedule[]>([]);
  const [scheduleId, setScheduleId] = useState('');
  const [fullName, setFullName] = useState('');
  const [skillLevel, setSkillLevel] = useState('N3');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('club')?.trim().toUpperCase() || '';
    setClubCode(code);
    if (!code) {
      setMessage('게스트 신청 링크가 올바르지 않습니다. 클럽 관리자에게 링크를 요청해주세요.');
      setLoading(false);
      return;
    }

    fetch(`/api/auth/register-guest?club=${encodeURIComponent(code)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || '신청 정보를 불러오지 못했습니다.');
        setClubName(payload.club?.name || '클럽');
        setSchedules(payload.schedules || []);
        setScheduleId(payload.schedules?.[0]?.id || '');
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '신청 정보를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!scheduleId || submitting) return;
    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/auth/register-guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubCode, scheduleId, fullName, skillLevel }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || '게스트 신청에 실패했습니다.');
      setMessage(`${payload.clubName} ${payload.matchDescription}에 게스트 신청이 완료되었습니다.`);
      setFullName('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '게스트 신청에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-blue-600">BADMINTON GUEST</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{clubName ? `${clubName} 게스트 신청` : '게스트 신청'}</h1>
        <p className="mt-2 text-sm text-slate-500">선택한 클럽의 경기 일정에만 참가 신청됩니다.</p>

        {loading ? <p className="mt-8 text-sm text-slate-500">신청 정보를 불러오는 중입니다.</p> : (
          <form className="mt-6 space-y-4" onSubmit={submit}>
            <label className="block text-sm font-medium text-slate-700">참가 경기
              <select value={scheduleId} onChange={(event) => setScheduleId(event.target.value)} disabled={!schedules.length || submitting} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100">
                {schedules.length === 0 ? <option value="">신청 가능한 경기가 없습니다.</option> : schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>{schedule.match_date} {schedule.start_time?.slice(0, 5)} · {schedule.description || '정기 경기'}{schedule.location ? ` (${schedule.location})` : ''}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">이름
              <input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="이름을 입력해주세요" disabled={submitting || !schedules.length} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100" />
            </label>
            <label className="block text-sm font-medium text-slate-700">레벨
              <select value={skillLevel} onChange={(event) => setSkillLevel(event.target.value)} disabled={submitting || !schedules.length} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-100">
                {['N3', 'N2', 'N1', 'E3', 'E2', 'E1', 'D3', 'D2', 'D1', 'C3', 'C2', 'C1', 'B3', 'B2', 'B1', 'A3', 'A2', 'A1'].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
            <button type="submit" disabled={submitting || !schedules.length} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              {submitting ? '신청 중...' : '게스트 참가 신청'}
            </button>
          </form>
        )}
        {message && <p className="mt-5 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{message}</p>}
      </section>
    </main>
  );
}

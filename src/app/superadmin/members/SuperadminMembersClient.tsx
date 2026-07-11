'use client';

import { useMemo, useState, useTransition } from 'react';
import { createSuperadminMembersByNames, updateSuperadminClubMemberRole, type ClubMemberRole } from './actions';

type Club = { id: string; name: string; code: string | null };
type Membership = { id: string; club_id: string; user_id: string; role: string | null; status: string | null; username: string; full_name: string; email: string; skill_level: string };
type Profile = { id: string; username: string | null; full_name: string | null; email: string | null; skill_level: string | null };
type SortKey = 'name' | 'email' | 'skill_level' | 'role';

export default function SuperadminMembersClient({ clubs, memberships, profiles }: { clubs: Club[]; memberships: Membership[]; profiles: Profile[] }) {
  const [selectedClubId, setSelectedClubId] = useState(clubs[0]?.id || '');
  const [bulkNames, setBulkNames] = useState('');
  const [isPending, startTransition] = useTransition();
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAscending, setSortAscending] = useState(true);
  const selectedClub = clubs.find((club) => club.id === selectedClubId);
  const clubMembers = memberships.filter((member) => member.club_id === selectedClubId);
  const sortedClubMembers = useMemo(() => {
    const roleOrder: Record<string, number> = { owner: 0, admin: 1, manager: 2, member: 3 };
    return [...clubMembers].sort((left, right) => {
      const leftValue = sortKey === 'name'
        ? left.full_name || left.username || ''
        : sortKey === 'role'
          ? String(roleOrder[left.role || 'member'] ?? 99)
          : String(left[sortKey] || '');
      const rightValue = sortKey === 'name'
        ? right.full_name || right.username || ''
        : sortKey === 'role'
          ? String(roleOrder[right.role || 'member'] ?? 99)
          : String(right[sortKey] || '');
      const comparison = sortKey === 'role'
        ? Number(leftValue) - Number(rightValue)
        : leftValue.localeCompare(rightValue, 'ko', { numeric: true, sensitivity: 'base' });
      return sortAscending ? comparison : -comparison;
    });
  }, [clubMembers, sortAscending, sortKey]);
  const roles: Array<{ value: ClubMemberRole; label: string }> = [
    { value: 'owner', label: '소유자' },
    { value: 'admin', label: '관리자' },
    { value: 'manager', label: '매니저' },
    { value: 'member', label: '회원' },
  ];

  const handleBulkAdd = () => {
    const names = Array.from(new Set(bulkNames.split(',').map((name) => name.trim()).filter(Boolean)));
    if (names.length === 0) {
      alert('쉼표로 구분된 회원 이름을 입력해 주세요.');
      return;
    }

    startTransition(async () => {
      const result = await createSuperadminMembersByNames(selectedClubId, names);
      if (result.error) {
        alert(result.error);
        return;
      }
      const failedMessage = result.failed?.length ? '\n실패: ' + result.failed.join(', ') : '';
      alert((result.created?.length || 0) + '명의 신규 회원을 생성했습니다.\n초기 비밀번호: ' + result.initialPassword + failedMessage);
      setBulkNames('');
    });
  };

  const handleRoleChange = (member: Membership, role: ClubMemberRole) => {
    startTransition(async () => {
      const result = await updateSuperadminClubMemberRole(member.club_id, member.user_id, role);
      if (result.error) {
        alert(result.error);
        return;
      }
      window.location.reload();
    });
  };

  const handleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortAscending((current) => !current);
      return;
    }
    setSortKey(nextKey);
    setSortAscending(true);
  };

  const sortIndicator = (key: SortKey) => sortKey === key ? (sortAscending ? ' ↑' : ' ↓') : '';

  return (
    <div className="w-full max-w-none">
      <div className="rounded-2xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 px-5 py-4 text-white shadow-lg sm:px-6 sm:py-5">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-200">Club Members</div>
        <h1 className="mt-1 text-xl font-black sm:text-2xl">클럽 회원 관리</h1>
        <p className="mt-1 text-xs leading-5 text-indigo-100">회원 일괄 추가와 클럽별 권한을 관리합니다.</p>
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <label className="block text-sm font-bold text-slate-700">클럽 선택</label>
        <select value={selectedClubId} onChange={(event) => setSelectedClubId(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-500">
          {clubs.map((club) => <option key={club.id} value={club.id}>{club.name}{club.code ? ' (' + club.code + ')' : ''}</option>)}
        </select>

        <label className="mt-6 block text-sm font-bold text-slate-700">회원 이름</label>
        <textarea value={bulkNames} onChange={(event) => setBulkNames(event.target.value)} placeholder="홍길동, 김철수, 박영희" rows={5} className="mt-2 w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500" />
        <p className="mt-2 text-xs text-slate-500">예: 홍길동, 김철수, 박영희</p>

        <button type="button" disabled={isPending || !selectedClubId || !bulkNames.trim()} onClick={handleBulkAdd} className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
          {isPending ? '추가 중...' : selectedClub?.name + ' 회원 일괄 추가'}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-bold text-slate-900">{selectedClub?.name || '선택한 클럽'} 권한 설정</h2>
          <p className="mt-1 text-xs text-slate-500">클럽별 회원 권한만 변경됩니다.</p>
        </div>
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(6rem,0.7fr)_7rem] gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-bold text-slate-500 md:grid">
          {([['name', '회원명'], ['email', '이메일'], ['skill_level', '급수'], ['role', '권한']] as Array<[SortKey, string]>).map(([key, label]) => (
            <button key={key} type="button" onClick={() => handleSort(key)} className="text-left transition hover:text-indigo-600">
              {label}{sortIndicator(key)}
            </button>
          ))}
        </div>
        <div className="divide-y divide-slate-100">
          {sortedClubMembers.map((member) => (
            <div key={member.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(6rem,0.7fr)_7rem] md:items-center">
              <button type="button" onClick={() => handleSort('name')} className="text-left font-semibold text-slate-900 hover:text-indigo-600">
                {member.full_name || member.username || '이름 없음'}{sortIndicator('name')}
              </button>
              <button type="button" onClick={() => handleSort('email')} className="truncate text-left text-sm text-slate-600 hover:text-indigo-600">
                {member.email || '-'}{sortIndicator('email')}
              </button>
              <button type="button" onClick={() => handleSort('skill_level')} className="text-left text-sm text-slate-600 hover:text-indigo-600">
                {member.skill_level || '급수 미지정'}{sortIndicator('skill_level')}
              </button>
              <select
                value={(member.role || 'member') as ClubMemberRole}
                disabled={isPending}
                onChange={(event) => handleRoleChange(member, event.target.value as ClubMemberRole)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 disabled:opacity-60"
              >
                {roles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </div>
          ))}
        </div>
        {clubMembers.length === 0 && <div className="p-10 text-center text-sm text-slate-500">선택한 클럽의 회원이 없습니다.</div>}
      </div>
      </div>
    </div>
  );
}

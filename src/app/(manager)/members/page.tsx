import { redirect } from 'next/navigation'
import type { AdminUser } from '@/types'
import { getSupabaseServerClient, getFilteredAdminClient } from '@/lib/supabase-server'
import { getClubRole } from '@/lib/club-auth'
import { isUserAdmin } from '@/lib/auth'
import UserManagementClient from './UserManagementClient'
import { SKILL_LEVEL_CODES } from '@/lib/skill-levels'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

type AttendanceSummary = Record<
  string,
  {
    total: number
    last30: number
    lastAttended: string | null
  }
>

export default async function ManagerMembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>
}) {
  const supabase = await getSupabaseServerClient()

  // 1) 세션 확인
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 2) 매니저 권한 확인
  const cookieStore = await cookies();
  const activeClubId = cookieStore.get('active_club_id')?.value;
  if (!activeClubId) redirect('/manager/match-assignment') // or somewhere

  const isSysAdmin = await isUserAdmin(supabase, user)
  if (!isSysAdmin) {
    const clubRole = await getClubRole(supabase, user.id, activeClubId)
    if (!clubRole || !['owner', 'admin', 'manager'].includes(clubRole)) {
        redirect('/unauthorized')
    }
  }

  // 3) 사용자 목록 및 부가 데이터 병렬 조회
  // Note: Use filtered admin client to bypass RLS issues for manager
  const filteredAdmin = await getFilteredAdminClient()
  const [
    { data: clubMembersRows, error },
    { data: aliasesRows },
    { data: recentAttendanceRows }
  ] = await Promise.all([
    filteredAdmin
      .from('club_members')
      .select(`
        role,
        status,
        coin_wins,
        coin_losses,
        profiles (
          id, user_id, username, full_name, skill_level, gender, email, updated_at
        )
      `)
      .eq('club_id', activeClubId)
      .neq('role', 'admin'),
    (filteredAdmin as any).from('club_level_aliases').select('level_code, alias').eq('club_id', activeClubId),
    (filteredAdmin as any).from('attendances').select('user_id, attended_at, status').eq('club_id', activeClubId).eq('status', 'present').order('attended_at', { ascending: false })
  ])

  if (error) {
    return (
      <div className="w-full mt-10 p-6 bg-white shadow rounded text-red-500">
        <h2 className="text-2xl font-bold mb-4 text-center">접근 불가</h2>
        <p className="text-center">이 페이지는 클럽 매니저만 접근할 수 있습니다.</p>
        <p className="text-center mt-2 text-sm text-gray-500">오류: {error.message}</p>
      </div>
    )
  }

  let users: AdminUser[] = (clubMembersRows || []).map((cm: any) => {
    const p = cm.profiles || {}
    return {
      id: p.user_id ?? p.id,
      email: (p.email ?? '') as string,
      username: p.username ?? undefined,
      full_name: p.full_name ?? undefined,
      role: cm.role ?? 'member', // club role
      skill_level: p.skill_level ?? 'E2',
      skill_label: undefined,
      gender: p.gender ?? undefined,
      created_at: (p.updated_at ?? new Date().toISOString()) as string,
      coin_wins: cm.coin_wins || 0,
      coin_losses: cm.coin_losses || 0,
    }
  })

  // ㄱㄴ 순 정렬: username 우선, 없으면 full_name, 없으면 email
  try {
    const collator = new Intl.Collator('ko');
    users.sort((a, b) => {
      const aKey = (a.username || a.full_name || a.email || '').toString();
      const bKey = (b.username || b.full_name || b.email || '').toString();
      return collator.compare(aKey, bKey);
    });
  } catch {
    // Intl.Collator가 지원되지 않으면 기본 정렬
    users.sort((a, b) => ('' + (a.username || a.full_name || a.email)).localeCompare('' + (b.username || b.full_name || b.email)));
  }

  // Level Options (A3 ~ E1)
  const aliasMap = new Map<string, string>((aliasesRows || []).map((r: any) => [r.level_code, r.alias]));
  
  const levelOptions = SKILL_LEVEL_CODES.map((code, index) => ({
      code,
      description: aliasMap.get(code) || code,
      score: SKILL_LEVEL_CODES.length - index,
  }));

  const levelOptionByCode = new Map<string, any>(levelOptions.map((option) => [option.code, option]))
  users = users.map((user) => ({
    ...user,
    skill_level: String(user.skill_level ?? '').trim().toUpperCase() || 'E2',
    skill_label: levelOptionByCode.get(String(user.skill_level ?? '').trim().toUpperCase())?.description ?? user.skill_label,
  }))

  const attendanceSummary: AttendanceSummary = {}
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffTime = thirtyDaysAgo.getTime();

  for (const row of (recentAttendanceRows || []) as any[]) {
    const userId = row.user_id;
    if (!userId) continue;

    if (!attendanceSummary[userId]) {
      attendanceSummary[userId] = {
        total: 0,
        last30: 0,
        lastAttended: null,
      }
    }

    attendanceSummary[userId].total += 1;
    
    const attendedAt = typeof row.attended_at === 'string' ? row.attended_at : null;
    if (attendedAt) {
      if (new Date(attendedAt).getTime() >= cutoffTime) {
         attendanceSummary[userId].last30 += 1;
      }
      if (!attendanceSummary[userId].lastAttended || attendedAt > attendanceSummary[userId].lastAttended!) {
        attendanceSummary[userId].lastAttended = attendedAt
      }
    }
  }

  const resolvedSearchParams = (await searchParams) || {}
  const initialTab = typeof resolvedSearchParams.tab === 'string' ? resolvedSearchParams.tab : 'overview'

  // 4) 렌더
  return (
    <div className="w-full p-6 pt-0">
      <UserManagementClient
        users={users}
        myUserId={user.id}
        myUserEmail={user.email || ''}
        levelOptions={levelOptions}
        attendanceSummary={attendanceSummary}
        initialTab={initialTab}
        ratingSettings={{ start_date: null, end_date: null }}
      />
    </div>
  )
}

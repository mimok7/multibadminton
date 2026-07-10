import { redirect } from 'next/navigation'
import type { AdminUser } from '@/types'
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server'
import { isUserAdmin } from '@/lib/auth'
import UserManagementClient from './UserManagementClient'
import type { Database } from '@/types/supabase'
import { SKILL_LEVEL_CODES } from '@/lib/skill-levels'
import { getActiveClubId } from '@/lib/club'

export const dynamic = 'force-dynamic'

type ProfileRow = Database['public']['Tables']['profiles']['Row']

type AttendanceSummary = Record<
  string,
  {
    total: number
    last30: number
    lastAttended: string | null
  }
>

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>
}) {
  const supabase = await getSupabaseServerClient()

  // 1) 세션 확인
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 2) 관리자 권한 확인


  // 3) 사용자 목록 및 부가 데이터 병렬 조회
  const supabaseAdmin = await getFilteredAdminClient()
  const activeClubId = await getActiveClubId()
  if (!activeClubId) redirect('/select-club')
  const today = new Date()
  const cutoff = new Date(today)
  cutoff.setDate(today.getDate() - 30)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const [
    rpc,
    { data: levelInfoRows },
    { data: profileLinkRows },
    { data: ratingSettingsRow },
    { data: attendanceSummaryRows },
    { data: recentAttendanceRows }
  ] = await Promise.all([
    supabase.rpc('get_all_users'),
    supabaseAdmin.from('level_info').select('id, code, name, description, score').order('score', { ascending: false, nullsFirst: false }),
    supabaseAdmin.from('profiles').select('id, user_id, coin_wins, coin_losses'),
    (supabaseAdmin as any).from('member_rating_settings').select('start_date, end_date').eq('id', 1).maybeSingle(),
    Promise.resolve(supabaseAdmin.rpc('get_attendance_summary', { p_club_id: activeClubId })).catch(() => ({ data: null })),
    supabaseAdmin.from('attendances').select('user_id, attended_at, status').gte('attended_at', cutoffDate).eq('status', 'present').order('attended_at', { ascending: false })
  ])

  let users: AdminUser[] = []
  const rpcData = rpc.data as AdminUser[] | null
  if (!rpc.error && rpcData) {
    users = rpcData.slice()
  } else {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, user_id, username, full_name, role, skill_level, gender, email, updated_at')
      .order('updated_at', { ascending: false })
    if (error) {
      return (
        <div className="w-full mt-10 p-6 bg-white shadow rounded text-red-500">
          <h2 className="text-2xl font-bold mb-4 text-center">접근 불가</h2>
          <p className="text-center">이 페이지는 관리자만 접근할 수 있습니다.</p>
          <p className="text-center mt-2 text-sm text-gray-500">오류: {error.message}</p>
        </div>
      )
    }
    users = ((profiles || []) as ProfileRow[]).map((p) => ({
      id: p.user_id ?? p.id,
      email: (p.email ?? '') as string,
      username: p.username ?? undefined,
      full_name: p.full_name ?? undefined,
      role: p.role ?? 'user',
      skill_level: p.skill_level ?? 'E2',
      skill_label: undefined,
      gender: p.gender ?? undefined,
      created_at: (p.updated_at ?? new Date().toISOString()) as string,
    })) as AdminUser[]
  }

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

  const ratingSettings = {
    start_date: ratingSettingsRow?.start_date ?? null,
    end_date: ratingSettingsRow?.end_date ?? null,
  }

  const levelOptionsFromDb = ((levelInfoRows || []) as Array<Pick<Database['public']['Tables']['level_info']['Row'], 'id' | 'code' | 'name' | 'description' | 'score'>>)
    .filter((row) => Boolean(row.code))
    .map((row) => ({
      code: String(row.code).trim().toUpperCase(),
      description: row.description?.trim() || row.name?.trim() || row.code?.trim() || `레벨 ${row.id}`,
      score: row.score,
    }))

  const levelOptions = levelOptionsFromDb.length > 0
    ? levelOptionsFromDb
    : [
      ...SKILL_LEVEL_CODES.map((code, index) => ({
        code,
        description: code,
        score: SKILL_LEVEL_CODES.length - index,
      })),
      { code: 'O', description: '기타', score: null },
    ]

  const coinWinsMap = new Map(
    (profileLinkRows || []).map((row) => [row.user_id || row.id, row.coin_wins || 0])
  )
  const coinLossesMap = new Map(
    (profileLinkRows || []).map((row) => [row.user_id || row.id, row.coin_losses || 0])
  )

  const levelOptionByCode = new Map(levelOptions.map((option) => [option.code, option]))
  users = users.map((user) => ({
    ...user,
    skill_level: String(user.skill_level ?? '').trim().toUpperCase() || 'E2',
    skill_label: levelOptionByCode.get(String(user.skill_level ?? '').trim().toUpperCase())?.description ?? user.skill_label,
    coin_wins: coinWinsMap.get(user.id) || 0,
    coin_losses: coinLossesMap.get(user.id) || 0,
  }))

  const attendanceSummary: AttendanceSummary = {}
  const profileIdToUserId = new Map(
    (profileLinkRows || []).map((row) => [row.id, row.user_id || row.id])
  )

  if (attendanceSummaryRows && Array.isArray(attendanceSummaryRows) && attendanceSummaryRows.length > 0) {
    // RPC 함수가 정상 동작하는 경우 (Supabase SQL 적용 후)
    for (const row of attendanceSummaryRows as any[]) {
      const rawUserId = typeof row.user_id === 'string' ? row.user_id : null
      const userId = rawUserId ? profileIdToUserId.get(rawUserId) || rawUserId : null
      if (!userId) continue
      
      attendanceSummary[userId] = {
        total: Number(row.total_count) || 0,
        last30: Number(row.last30_count) || 0,
        lastAttended: typeof row.last_attended_at === 'string' ? row.last_attended_at : null,
      }
    }
  } else {
    // Fallback: RPC가 없거나 실패한 경우, 최근 30일치(recentAttendanceRows)만으로 계산.
    // 주의: total은 지난 30일 출석 수와 동일하게 표시됩니다.
    for (const row of recentAttendanceRows || []) {
      const rawUserId = typeof row.user_id === 'string' ? row.user_id : null
      const userId = rawUserId ? profileIdToUserId.get(rawUserId) || rawUserId : null
      if (!userId) continue

      if (!attendanceSummary[userId]) {
        attendanceSummary[userId] = {
          total: 0,
          last30: 0,
          lastAttended: null,
        }
      }

      // fallback 상태이므로 total도 최근 30일치로 카운트
      attendanceSummary[userId].total += 1
      attendanceSummary[userId].last30 += 1

      const attendedAt = typeof row.attended_at === 'string' ? row.attended_at : null
      if (attendedAt && (!attendanceSummary[userId].lastAttended || attendedAt > attendanceSummary[userId].lastAttended!)) {
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
        ratingSettings={ratingSettings}
      />
    </div>
  )
}

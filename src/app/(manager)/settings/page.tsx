import { redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase-server'
import { getClubRole } from '@/lib/club-auth'
import { isUserAdmin } from '@/lib/auth'
import { SKILL_LEVEL_CODES } from '@/lib/skill-levels'
import ClubSettingsClient from './ClubSettingsClient'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export default async function ClubSettingsPage() {
  const supabase = await getSupabaseServerClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cookieStore = await cookies();
  const activeClubId = cookieStore.get('active_club_id')?.value;
  if (!activeClubId) redirect('/')

  const isSysAdmin = await isUserAdmin(supabase, user)
  if (!isSysAdmin) {
    const clubRole = await getClubRole(supabase, user.id, activeClubId)
    if (!clubRole || !['owner', 'admin', 'manager'].includes(clubRole)) {
        redirect('/unauthorized')
    }
  }

  // Fetch aliases
  const { data: aliasesRows } = await (supabase as any)
    .from('club_level_aliases')
    .select('level_code, alias')
    .eq('club_id', activeClubId)
  const aliasMap = new Map<string, string>((aliasesRows || []).map((r: any) => [r.level_code, r.alias]));

  const levelOptions = SKILL_LEVEL_CODES.map((code) => ({
      code: code as string,
      alias: aliasMap.get(code) || code,
  }));

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6 text-slate-900">클럽 설정</h1>
      <ClubSettingsClient levelOptions={levelOptions} clubId={activeClubId} />
    </div>
  )
}

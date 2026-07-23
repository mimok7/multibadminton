import { getRoleFromUser, isAdminRole, isManagerRole, isSuperadminProfile } from '@/lib/auth';
import { getActiveClubId } from '@/lib/club';
import {
  getFilteredAdminClient,
  getSupabaseServerClient,
  getUnfilteredGlobalAdminClient,
} from '@/lib/supabase-server';

export async function getClubManagerContext(options?: { allowSystemManager?: boolean }) {
  const [clubId, supabase] = await Promise.all([
    getActiveClubId(),
    getSupabaseServerClient(),
  ]);
  if (!clubId) return { error: 'club_not_selected' as const };

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: 'unauthorized' as const };

  const roleLookupClient = getUnfilteredGlobalAdminClient();
  const { data: profile } = await roleLookupClient
    .from('profiles')
    .select('id, user_id, role, username, full_name, email')
    .or(`user_id.eq.${user.id},id.eq.${user.id}`)
    .limit(1)
    .maybeSingle();
  if (!profile) return { error: 'forbidden' as const };

  const isGlobalAdmin =
    isSuperadminProfile(profile) ||
    isAdminRole(profile.role) ||
    isAdminRole(getRoleFromUser(user));
  const isSystemManager = isManagerRole(profile.role) || isManagerRole(getRoleFromUser(user));
  const hasSystemAccess = isGlobalAdmin || (options?.allowSystemManager === true && isSystemManager);
  const { data: membership } = hasSystemAccess
    ? { data: null }
    : await roleLookupClient
      .from('club_members')
      .select('role')
      .eq('user_id', profile.id)
      .eq('club_id', clubId)
      .eq('status', 'active')
      .maybeSingle();
  const clubRole = membership?.role ?? null;
  const canManageClub = hasSystemAccess || ['owner', 'admin', 'manager'].includes(clubRole || '');
  if (!canManageClub) return { error: 'forbidden' as const };

  return {
    user,
    profile,
    clubId,
    clubRole: isGlobalAdmin ? 'admin' : hasSystemAccess ? 'manager' : clubRole,
    adminSupabase: await getFilteredAdminClient({ activeClubId: clubId, profile }),
  };
}

/** Club administration tools: owner/admin only (plus global superadmin). */
export async function getClubAdminContext() {
  const context = await getClubManagerContext();
  if ('error' in context) return context;

  if (!['owner', 'admin'].includes(context.clubRole || '')) {
    return { error: 'forbidden' as const };
  }

  return context;
}

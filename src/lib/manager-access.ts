import { getClubRole } from '@/lib/club-auth';
import { getUserRole, isAdminRole, getProfileByUserId } from '@/lib/auth';
import { getActiveClubId } from '@/lib/club';
import {
  getFilteredAdminClient,
  getSupabaseServerClient,
  getUnfilteredGlobalAdminClient,
} from '@/lib/supabase-server';

export async function getClubManagerContext() {
  const clubId = await getActiveClubId();
  if (!clubId) return { error: 'club_not_selected' as const };

  const supabase = await getSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: 'unauthorized' as const };

  const roleLookupClient = getUnfilteredGlobalAdminClient();
  const [profile, globalRole, clubRole] = await Promise.all([
    getProfileByUserId(roleLookupClient, user.id),
    getUserRole(roleLookupClient, user),
    getClubRole(roleLookupClient, user.id, clubId),
  ]);

  const isGlobalAdmin = isAdminRole(globalRole);
  const canManageClub = isGlobalAdmin || ['owner', 'admin', 'manager'].includes(clubRole || '');
  if (!profile || !canManageClub) return { error: 'forbidden' as const };

  return {
    user,
    clubId,
    clubRole: isGlobalAdmin ? 'admin' : clubRole,
    adminSupabase: await getFilteredAdminClient(),
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

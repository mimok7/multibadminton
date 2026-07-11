'use server';

import { getClubManagerContext } from '@/lib/manager-access';

export async function fetchAdminMembers() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    throw new Error(context.error === 'unauthorized' ? 'Unauthorized' : 'Forbidden');
  }

  const { data: members, error: membersError } = await context.adminSupabase
    .from('club_members')
    .select('user_id')
    .eq('status', 'active');

  if (membersError) throw membersError;

  const profileIds = (members || []).map((member) => member.user_id).filter(Boolean);
  if (profileIds.length === 0) return [];

  const { data: profiles, error } = await context.adminSupabase
    .from('profiles')
    .select('id, username, full_name, skill_level, gender')
    .in('id', profileIds)
    .order('username', { ascending: true });

  if (error) throw error;
  return profiles || [];
}

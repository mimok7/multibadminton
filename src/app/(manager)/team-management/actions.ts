'use server';

import { getProfileByUserId } from '@/lib/auth';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

export async function fetchAdminMembers() {
  const adminSupabase = await getFilteredAdminClient();
  const serverSupabase = await getSupabaseServerClient();

  const { data: { user }, error: authError } = await serverSupabase.auth.getUser();
  if (authError || !user) throw new Error('Unauthorized');

  const profile = await getProfileByUserId(adminSupabase, user.id);
  if (profile?.role !== 'admin' && profile?.role !== 'manager') {
    throw new Error('Forbidden');
  }

  const { data: profiles, error } = await adminSupabase
    .from('profiles')
    .select('id, username, full_name, skill_level, gender')
    .order('username', { ascending: true });

  if (error) throw error;
  return profiles || [];
}

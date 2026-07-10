'use server';

import { getProfileByUserId } from '@/lib/auth';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

export async function fetchProfileServer(userId: string) {
  const adminSupabase = await getFilteredAdminClient();
  const serverSupabase = await getSupabaseServerClient();

  // Verify the requester is logged in
  const { data: { user }, error: authError } = await serverSupabase.auth.getUser();
  if (authError || !user) throw new Error('Unauthorized');

  // Verify the requester is requesting their own profile, OR they are admin/manager
  if (user.id !== userId) {
    const requesterProfile = await getProfileByUserId(adminSupabase, user.id);
    if (requesterProfile?.role !== 'admin' && requesterProfile?.role !== 'manager') {
      throw new Error('Forbidden');
    }
  }

  const profile = await getProfileByUserId(adminSupabase, userId);
  
  // Return plain object to avoid Next.js serialization warnings/errors
  if (!profile) return null;
  
  return {
    id: profile.id,
    user_id: profile.user_id,
    username: profile.username,
    full_name: profile.full_name,
    email: profile.email,
    role: profile.role,
    skill_level: profile.skill_level,
    gender: profile.gender,
    avatar_url: profile.avatar_url,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    coin_balance: profile.coin_balance,
    coin_wins: profile.coin_wins,
    coin_losses: profile.coin_losses,
    coin_updated_at: profile.coin_updated_at,
    is_guest: profile.is_guest,
    skill_level_name: profile.skill_level_name,
  };
}

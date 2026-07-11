import { getUnfilteredGlobalAdminClient, getUnfilteredSupabaseServerClient } from '@/lib/supabase-server';
import { isSuperadminProfile } from '@/lib/auth';

/**
 * Server-only guard for system-wide administration.
 * The profile role is the source of truth; club-level roles must not grant
 * access to global club management.
 */
export async function requireSuperadmin() {
  const sessionClient = await getUnfilteredSupabaseServerClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();

  if (!user) {
    throw new Error('로그인이 필요합니다.');
  }

  // The session client verifies the current cookie. Use the service client
  // only for the following profile lookup so RLS cannot hide the role row.
  const supabaseAdmin = getUnfilteredGlobalAdminClient();
  const { data: profileByUserId, error: profileLookupError } = await supabaseAdmin
    .from('profiles')
    .select('role, username')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  const profile = profileByUserId ?? (await supabaseAdmin
    .from('profiles')
    .select('role, username')
    .eq('id', user.id)
    .limit(1)
    .maybeSingle()).data;

  if (profileLookupError && !profile) {
    throw new Error('슈퍼관리자 프로필을 확인할 수 없습니다.');
  }

  const normalizedProfile = profile as { role?: string | null; username?: string | null } | null;
  if (!isSuperadminProfile(normalizedProfile as Parameters<typeof isSuperadminProfile>[0])) {
    throw new Error('슈퍼관리자 권한이 필요합니다.');
  }

  return {
    user,
    profile,
    supabaseAdmin,
  };
}

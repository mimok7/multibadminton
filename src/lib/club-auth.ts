import { getProfileByUserId } from '@/lib/auth';

type ClubAuthClient = Parameters<typeof getProfileByUserId>[0];

export async function getClubRole(
  supabase: ClubAuthClient,
  userId: string,
  clubId: string
): Promise<string | null> {
  // profile id 조회 (auth.users id와 다를 수 있으므로 매핑)
  const profile = await getProfileByUserId(supabase, userId);

  if (!profile) return null;

  const profileId = profile.id;

  const { data, error } = await supabase
    .from('club_members')
    .select('role')
    .eq('user_id', profileId)
    .eq('club_id', clubId)
    .eq('status', 'active')
    .single();

  if (error || !data) return null;
  return data.role;
}

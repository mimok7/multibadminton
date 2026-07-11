import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export type AppProfile = Pick<
  Database['public']['Tables']['profiles']['Row'],
  | 'id'
  | 'user_id'
  | 'username'
  | 'full_name'
  | 'email'
  | 'role'
  | 'skill_level'
  | 'gender'
  | 'avatar_url'
  | 'created_at'
  | 'updated_at'
  | 'coin_balance'
  | 'coin_wins'
  | 'coin_losses'
  | 'coin_updated_at'
  | 'is_guest'
> & {
  skill_level_name?: string | null;
};

type ProfileLookupClient = Pick<SupabaseClient<Database, any, any>, 'from'>;

// `admin` is retained as a legacy alias; the canonical global role is superadmin.
// Global administration is intentionally separate from club-level admin.
// The admin role in club_members must not grant system access.
const ADMIN_ROLE_ALIASES = new Set(['superadmin', '시스템 관리자', '슈퍼관리자']);
const MANAGER_ROLE_ALIASES = new Set(['manager', '매니저', '운영자']);
const USER_ROLE_ALIASES = new Set(['user', 'member', '일반 사용자', '일반회원']);

export function normalizeRole(role: unknown): string | null {
  if (typeof role !== 'string') {
    return null;
  }

  const normalized = role.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if (ADMIN_ROLE_ALIASES.has(normalized)) {
    return 'admin';
  }

  if (MANAGER_ROLE_ALIASES.has(normalized)) {
    return 'manager';
  }

  if (USER_ROLE_ALIASES.has(normalized)) {
    return 'member';
  }

  return normalized;
}

export function isSuperadminProfile(
  profile: Pick<AppProfile, 'role' | 'username'> | null | undefined
): boolean {
  const rawRole = typeof profile?.role === 'string' ? profile.role.trim().toLowerCase() : '';
  const username = typeof profile?.username === 'string' ? profile.username.trim() : '';
  return rawRole === 'superadmin' || username === '슈퍼관리자' || username === '관리자';
}

export function isAdminRole(role: unknown): boolean {
  return normalizeRole(role) === 'admin';
}

export function isManagerRole(role: unknown): boolean {
  return normalizeRole(role) === 'manager';
}

export function isAdminOrManagerRole(role: unknown): boolean {
  const normalized = normalizeRole(role);
  return normalized === 'admin' || normalized === 'manager';
}

export function getRoleFromUser(user: User | null | undefined): string | null {
  if (!user) {
    return null;
  }

  return normalizeRole(user.app_metadata?.role ?? user.user_metadata?.role);
}

export async function getProfileByUserId(
  supabase: ProfileLookupClient,
  userId: string
): Promise<AppProfile | null> {
  // Fast path: try exact user_id match first (most common case)
  const { data: exactMatch, error: exactError } = await supabase
    .from('profiles')
    .select(`
      id,
      user_id,
      username,
      full_name,
      email,
      role,
      skill_level,
      gender,
      avatar_url,
      created_at,
      updated_at,
      coin_balance,
      coin_wins,
      coin_losses,
      coin_updated_at,
      is_guest,
      level_info:level_info!skill_level(name)
    `)
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!exactError && exactMatch) {
    return {
      ...(exactMatch as any),
      skill_level_name: (exactMatch as any)?.level_info?.name || null,
    } as AppProfile;
  }

  // Fallback: try by profile id
  const { data: idMatch, error: idError } = await supabase
    .from('profiles')
    .select(`
      id,
      user_id,
      username,
      full_name,
      email,
      role,
      skill_level,
      gender,
      avatar_url,
      created_at,
      updated_at,
      coin_balance,
      coin_wins,
      coin_losses,
      coin_updated_at,
      is_guest,
      level_info:level_info!skill_level(name)
    `)
    .eq('id', userId)
    .limit(1)
    .maybeSingle();

  if (idError) {
    console.error('Profile lookup error:', idError);
    return null;
  }

  if (!idMatch) {
    return null;
  }

  return {
    ...(idMatch as any),
    skill_level_name: (idMatch as any)?.level_info?.name || null,
  } as AppProfile;
}

export async function getUserRole(
  supabase: ProfileLookupClient,
  user: User | null | undefined
): Promise<string | null> {
  if (!user) {
    return null;
  }

  const profile = await getProfileByUserId(supabase, user.id);
  const profileRole = normalizeRole(profile?.role);
  const userRole = getRoleFromUser(user);

  if (isAdminRole(profileRole) || isAdminRole(userRole)) {
    return 'admin';
  }

  if (isManagerRole(profileRole) || isManagerRole(userRole)) {
    return 'manager';
  }

  return profileRole ?? userRole;
}

export async function isUserAdmin(
  supabase: ProfileLookupClient,
  user: User | null | undefined
): Promise<boolean> {
  return isAdminOrManagerRole(await getUserRole(supabase, user));
}

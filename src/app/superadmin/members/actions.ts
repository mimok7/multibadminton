'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/superadmin';

export type ClubMemberRole = 'owner' | 'admin' | 'manager' | 'member' | 'guest';

const INITIAL_PASSWORD = 'bad123!';

export async function resetSuperadminMemberPassword(memberId: string) {
  try {
    const { supabaseAdmin } = await requireSuperadmin();
    if (!memberId) return { error: '회원 정보가 없습니다.' };

    // club_members.user_id is a profile ID in this project. Resolve it to the
    // Supabase Auth user before calling the admin-only password API.
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('id, user_id')
      .or(`id.eq.${memberId},user_id.eq.${memberId}`)
      .limit(1)
      .maybeSingle();
    if (profileError) return { error: profileError.message };
    if (!profile?.user_id) return { error: '이 회원은 로그인 계정이 연결되어 있지 않습니다.' };

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
      profile.user_id,
      {
        password: INITIAL_PASSWORD,
        user_metadata: { must_change_password: true },
      }
    );
    if (authError) return { error: authError.message };

    return { success: true, initialPassword: INITIAL_PASSWORD };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '비밀번호 초기화 중 오류가 발생했습니다.' };
  }
}

export async function updateSuperadminClubMemberRole(clubId: string, userId: string, role: ClubMemberRole) {
  try {
    const { supabaseAdmin } = await requireSuperadmin();
    const allowedRoles: ClubMemberRole[] = ['owner', 'admin', 'manager', 'member', 'guest'];
    if (!allowedRoles.includes(role)) return { error: '올바르지 않은 클럽 권한입니다.' };
    const { data, error } = await supabaseAdmin.from('club_members').update({ role }).eq('club_id', clubId).eq('user_id', userId).select('id, club_id, user_id, role, status').maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: '해당 클럽 회원을 찾을 수 없습니다.' };
    revalidatePath('/superadmin/members');
    return { success: true, member: data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '권한 변경 중 오류가 발생했습니다.' };
  }
}

export async function addSuperadminClubMembers(clubId: string, userIds: string[]) {
  try {
    const { supabaseAdmin } = await requireSuperadmin();
    const uniqueUserIds = Array.from(new Set(userIds.filter((id) => typeof id === 'string' && id.length > 0)));
    if (!clubId || uniqueUserIds.length === 0) return { error: '추가할 회원을 선택해 주세요.' };
    const { data, error } = await supabaseAdmin.from('club_members').upsert(
      uniqueUserIds.map((userId) => ({ club_id: clubId, user_id: userId, role: 'member', status: 'active' })),
      { onConflict: 'club_id,user_id' }
    ).select('id, club_id, user_id, role, status');
    if (error) return { error: error.message };
    revalidatePath('/superadmin/members');
    return { success: true, addedCount: data?.length || uniqueUserIds.length };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '회원 일괄 추가 중 오류가 발생했습니다.' };
  }
}

export async function addSuperadminClubMembersByNames(clubId: string, names: string[]) {
  try {
    const { supabaseAdmin } = await requireSuperadmin();
    const normalizedNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    if (!clubId || normalizedNames.length === 0) return { error: '추가할 회원 이름을 입력해 주세요.' };

    const [{ data: profiles, error: profilesError }, { data: memberships, error: membershipsError }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, username, full_name'),
      supabaseAdmin.from('club_members').select('user_id').eq('club_id', clubId),
    ]);
    if (profilesError) return { error: '회원 프로필 조회 실패: ' + profilesError.message };
    if (membershipsError) return { error: '기존 클럽 회원 조회 실패: ' + membershipsError.message };

    const existingIds = new Set((memberships || []).map((member: any) => member.user_id));
    const matchedIds: string[] = [];
    const notFound: string[] = [];
    const alreadyMembers: string[] = [];

    normalizedNames.forEach((name) => {
      const normalizedName = name.toLowerCase();
      const profile = (profiles || []).find((candidate: any) =>
        [candidate.full_name, candidate.username]
          .filter(Boolean)
          .some((value: string) => value.trim().toLowerCase() === normalizedName)
      );
      if (!profile) {
        notFound.push(name);
      } else if (existingIds.has(profile.id)) {
        alreadyMembers.push(name);
      } else {
        matchedIds.push(profile.id);
      }
    });

    if (matchedIds.length === 0) {
      return { error: '새로 추가할 회원이 없습니다.', notFound, alreadyMembers };
    }

    const { data, error } = await supabaseAdmin.from('club_members').upsert(
      matchedIds.map((userId) => ({ club_id: clubId, user_id: userId, role: 'member', status: 'active' })),
      { onConflict: 'club_id,user_id' }
    ).select('id');
    if (error) return { error: '클럽 회원 저장 실패: ' + error.message };

    revalidatePath('/superadmin/members');
    return { success: true, addedCount: data?.length || matchedIds.length, notFound, alreadyMembers };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '회원 일괄 추가 중 오류가 발생했습니다.' };
  }
}

export async function createSuperadminMembersByNames(clubId: string, names: string[]) {
  try {
    const { supabaseAdmin } = await requireSuperadmin();
    const uniqueNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
    if (!clubId || uniqueNames.length === 0) return { error: '추가할 회원 이름을 입력해 주세요.' };

    const created: string[] = [];
    const failed: string[] = [];
    const initialPassword = 'bad123!';

    for (const fullName of uniqueNames) {
      const email = 'member-' + crypto.randomUUID() + '@badminton.local';
      // full_name is the display name and may be duplicated. username is an
      // internal identifier, so never use the real name here: existing
      // username uniqueness constraints/triggers can otherwise make Auth
      // creation fail with the unhelpful "Database error creating new user".
      const username = 'member_' + crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const { data: authResult, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: initialPassword,
        email_confirm: true,
        user_metadata: { username, full_name: fullName, role: 'member', club_id: clubId, must_change_password: true },
      });
      if (authError || !authResult.user) {
        failed.push(fullName + (authError?.message ? ' (' + authError.message + ')' : ''));
        continue;
      }

      const authUserId = authResult.user.id;
      const { data: existingProfile } = await supabaseAdmin.from('profiles').select('id').eq('user_id', authUserId).limit(1).maybeSingle();
      const profileId = existingProfile?.id || authUserId;
      const profilePayload = { id: profileId, user_id: authUserId, email, username, full_name: fullName, role: 'member', skill_level: 'E2' };
      const profileResult = existingProfile
        ? await supabaseAdmin.from('profiles').update(profilePayload).eq('id', profileId).select('id').single()
        : await supabaseAdmin.from('profiles').upsert(profilePayload).select('id').single();

      if (profileResult.error) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        failed.push(fullName + ' (프로필 저장 실패: ' + profileResult.error.message + ')');
        continue;
      }

      const { error: membershipError } = await supabaseAdmin.from('club_members').upsert(
        { club_id: clubId, user_id: profileResult.data?.id || profileId, role: 'member', status: 'active' },
        { onConflict: 'club_id,user_id' }
      );
      if (membershipError) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        failed.push(fullName + ' (클럽 가입 실패: ' + membershipError.message + ')');
        continue;
      }
      created.push(fullName);
    }

    revalidatePath('/superadmin/members');
    return { success: created.length > 0, created, failed, initialPassword };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '신규 회원 생성 중 오류가 발생했습니다.' };
  }
}

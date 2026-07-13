'use server';

import { revalidatePath } from 'next/cache';
import {
    getFilteredAdminClient,
    getSupabaseServerClient,
    getUnfilteredGlobalAdminClient,
} from '@/lib/supabase-server';
import { getClubRole } from '@/lib/club-auth';
import { getUserRole, isAdminRole } from '@/lib/auth';
import { requireSuperadmin } from '@/lib/superadmin';
import { cookies } from 'next/headers';



async function getManagerContext() {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const cookieStore = await cookies();
    const activeClubId = cookieStore.get('active_club_id')?.value;
    if (!activeClubId) return null;

    // `profiles.role = superadmin` is a global role and must not depend on
    // the currently selected club. The legacy check only looked at the
    // normalized user role, so a superadmin could be rejected here when the
    // profile was named "슈퍼관리자" or when no club membership existed.
    let isSuperadmin = false;
    try {
        await requireSuperadmin();
        isSuperadmin = true;
    } catch {
        // Fall through to the normal club-role check below.
    }

    const isSysAdmin = isSuperadmin || isAdminRole(await getUserRole(supabase, user));
    const roleLookupClient = getUnfilteredGlobalAdminClient();
    let role: string | null = null;

    if (isSysAdmin) {
        const actualRole = await getClubRole(roleLookupClient, user.id, activeClubId);
        role = actualRole || 'admin';
    } else {
        const actualRole = await getClubRole(roleLookupClient, user.id, activeClubId);
        if (!actualRole || !['owner', 'admin'].includes(actualRole)) {
            return null;
        }
        role = actualRole;
    }

    return { user, clubId: activeClubId, role };
}

async function getTargetClubMember(
    supabaseAdmin: Awaited<ReturnType<typeof getFilteredAdminClient>>,
    clubId: string,
    userId: string,
) {
    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, user_id')
        .or(`user_id.eq.${userId},id.eq.${userId}`)
        .maybeSingle();

    if (profileError || !profile) return null;

    const { data: membership, error: membershipError } = await supabaseAdmin
        .from('club_members')
        .select('user_id')
        .eq('club_id', clubId)
        .eq('user_id', profile.id)
        .eq('status', 'active')
        .maybeSingle();

    if (membershipError || !membership) return null;
    return profile;
}

export type UpdateUserPayload = {
    username?: string | null;
    full_name?: string | null;
    role?: 'owner' | 'admin' | 'manager' | 'member' | 'user' | null;
    skill_level?: string | null;
    gender?: 'M' | 'F' | 'O' | string | null;
}

function toClubMemberRole(role: UpdateUserPayload['role']): 'manager' | 'member' | null {
    if (role === 'manager') return 'manager';
    if (role === 'member' || role === 'user') return 'member';
    return null;
}

export async function deleteUser(userId: string) {
    const supabaseAdmin = await getFilteredAdminClient();
    // In a multi-club system, a manager deleting a user should probably only remove them from the club,
    // NOT delete the global user (unless they are the owner and the user belongs to no other clubs).
    // For now, we will delete from club_members.
    try {
        const ctx = await getManagerContext();
        if (!ctx) return { error: '삭제 권한이 없습니다.' };

        const targetProfile = await getTargetClubMember(supabaseAdmin, ctx.clubId, userId);
        if (!targetProfile) return { error: '소속 클럽의 회원만 삭제할 수 있습니다.' };

        const { error } = await (supabaseAdmin as any)
            .from('club_members')
            .delete()
            .eq('club_id', ctx.clubId)
            .eq('user_id', targetProfile.id);

        if (error) {
            return { error: error.message };
        }

        revalidatePath('/manager/members');
        return { success: true };
    } catch (error) {
        return { error: String(error) };
    }
}

export async function updateUser(userId: string, updates: UpdateUserPayload) {
    const ctx = await getManagerContext();
    if (!ctx) return { error: '수정 권한이 없습니다.' };

    const supabaseAdmin = await getFilteredAdminClient();

    const targetProfile = await getTargetClubMember(supabaseAdmin, ctx.clubId, userId);
    if (!targetProfile) return { error: '소속 클럽의 회원만 수정할 수 있습니다.' };

    const profilePayload: Record<string, any> = {};
    if (updates.username !== undefined) profilePayload.username = updates.username || null;
    if (updates.full_name !== undefined) profilePayload.full_name = updates.full_name || null;
    if (updates.skill_level !== undefined) profilePayload.skill_level = updates.skill_level || null;
    if (updates.gender !== undefined) profilePayload.gender = updates.gender || null;

    // Update global profile
    if (Object.keys(profilePayload).length > 0) {
        const { error } = await supabaseAdmin
            .from('profiles')
            .update(profilePayload)
            .eq('id', targetProfile.id);
        if (error) return { error: error.message };
    }

    // Roles shown in the member UI are user/manager, while club_members stores member/manager.
    if (updates.role !== undefined) {
        const clubRole = toClubMemberRole(updates.role);
        if (!clubRole) {
            return { error: '관리자 또는 소유자 역할은 이 페이지에서 변경할 수 없습니다.' };
        }

        const { error } = await (supabaseAdmin as any)
            .from('club_members')
            .update({ role: clubRole })
            .eq('club_id', ctx.clubId)
            .eq('user_id', targetProfile.id);
        if (error) return { error: error.message };
    }

    revalidatePath('/manager/members');
    return { success: true };
}

export async function updateUsersBulk(items: Array<{ userId: string; updates: UpdateUserPayload }>) {
    const ctx = await getManagerContext();
    if (!ctx) return { error: '수정 권한이 없습니다.' };

    for (const item of items) {
        const result = await updateUser(item.userId, item.updates);
        if (result?.error) return result;
    }

    revalidatePath('/manager/members');
    return { success: true, updatedCount: items.length };
}

function romanizeSyllable(char: string): string {
    const code = char.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
        // Simplified romanization fallback
        return `user${code}`;
    }
    return char.toLowerCase();
}

function buildAutoEmail(fullName: string): string {
    const prefix = fullName.trim() ? 'user' : 'member';
    return `${prefix}_${crypto.randomUUID()}@badminton.local`;
}

export type CreateMemberPayload = {
    full_name: string;
    email?: string | null;
    password?: string | null;
    skill_level?: string | null;
    gender?: 'M' | 'F' | 'O' | string | null;
    role?: 'manager' | 'member' | 'user' | null;
};

export async function createMember(payload: CreateMemberPayload, options: { revalidate?: boolean } = {}) {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '추가 권한이 없습니다.' };

    const fullName = payload.full_name.trim();
    const email = (payload.email && payload.email.trim()) || buildAutoEmail(fullName);
    const password = (payload.password || 'bad123!').trim();

    if (!fullName) return { error: '이름을 입력해 주세요.' };
    if (!email) return { error: '이메일을 입력해 주세요.' };

    // 1. Supabase Auth 계정 생성
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { full_name: fullName, club_id: ctx.clubId }
    });

    if (authError) return { error: `인증 계정 생성 실패: ${authError.message}` };
    if (!authUser.user) return { error: '인증 계정 생성 결과가 유효하지 않습니다.' };

    const userId = authUser.user.id;

    // 2. 프로필 업데이트 (트리거가 생성했을 수도 있고 안 했을 수도 있음)
    const updatePayload = {
        username: fullName,
        full_name: fullName,
        skill_level: payload.skill_level || 'E2',
        gender: payload.gender || null,
    };
    
    // Upsert to ensure profile exists
    await supabaseAdmin.from('profiles').upsert({
        user_id: userId,
        ...updatePayload
    }, { onConflict: 'user_id' });

    // 3. 클럽 멤버십 연결
    const clubRole = payload.role === 'manager' ? 'manager' : 'member';
    await (supabaseAdmin as any).from('club_members').upsert({
        club_id: ctx.clubId,
        user_id: userId,
        role: clubRole,
        status: 'active'
    }, { onConflict: 'club_id,user_id' });

    if (options.revalidate !== false) revalidatePath('/manager/members');
    return { success: true };
}

export async function createMembersBulk(payload: { full_names: string; skill_level?: string | null; role?: 'manager' | 'member' | 'user' | null }) {
    const ctx = await getManagerContext();
    if (!ctx) return { error: '추가 권한이 없습니다.' };

    const names = payload.full_names.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
    if (names.length === 0) return { error: '추가할 회원 이름을 입력해 주세요.' };

    // Auth 계정 생성은 네트워크 작업이므로 한 명씩 처리하지 않고, 과도한
    // 동시 요청을 피하는 작은 동시성 풀로 처리합니다.
    const results: Array<{ name: string; success?: true; error?: string }> = new Array(names.length);
    let nextIndex = 0;
    const worker = async () => {
        while (true) {
            const index = nextIndex++;
            if (index >= names.length) return;
            const name = names[index];
            const result = await createMember({
                full_name: name,
                skill_level: payload.skill_level,
                role: payload.role,
            }, { revalidate: false });
            results[index] = result.error ? { name, error: result.error } : { name, success: true };
        }
    };
    await Promise.all(Array.from({ length: Math.min(3, names.length) }, worker));

    const successCount = results.filter((result) => result.success).length;
    const failCount = results.length - successCount;

    revalidatePath('/manager/members');
    return { success: true, successCount, failCount, results };
}

export async function resetUserPassword(userId: string, newPassword: string) {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '비밀번호 초기화 권한이 없습니다.' };

    const targetProfile = await getTargetClubMember(supabaseAdmin, ctx.clubId, userId);
    if (!targetProfile || !targetProfile.user_id) {
        return { error: '소속 클럽의 회원만 비밀번호를 초기화할 수 있습니다.' };
    }

    if (!newPassword || newPassword.trim().length < 6) {
        return { error: '비밀번호는 최소 6자리 이상이어야 합니다.' };
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        targetProfile.user_id,
        { password: newPassword.trim() }
    );

    if (authError) return { error: authError.message };

    return { success: true };
}

export async function resetMemberData(userId: string) {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '초기화 권한이 없습니다.' };

    const targetProfile = await getTargetClubMember(supabaseAdmin, ctx.clubId, userId);
    if (!targetProfile) return { error: '소속 클럽의 회원만 초기화할 수 있습니다.' };

    await (supabaseAdmin as any).from('club_members').update({
        coin_wins: 0,
        coin_losses: 0,
        coin_balance: 30
    }).eq('club_id', ctx.clubId).eq('user_id', targetProfile.id);

    revalidatePath('/manager/members');
    return { success: true };
}

export async function updateRatingSettings(startDate: string | null, endDate: string | null) {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '설정 권한이 없습니다.' };

    const { error } = await (supabaseAdmin as any)
        .from('member_rating_settings')
        .upsert({
            id: 1,
            start_date: startDate ? new Date(startDate).toISOString() : null,
            end_date: endDate ? new Date(endDate).toISOString() : null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

    if (error) return { error: error.message };

    revalidatePath('/manager/members');
    return { success: true };
}

export async function resetAttendanceAll() {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '권한이 없습니다.' };

    const { error } = await (supabaseAdmin as any)
        .from('attendances')
        .delete()
        .eq('club_id', ctx.clubId);

    if (error) return { error: error.message };

    revalidatePath('/manager/members');
    return { success: true };
}

export async function resetWinRateAll() {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '권한이 없습니다.' };

    const { error } = await (supabaseAdmin as any)
        .from('club_members')
        .update({
            coin_wins: 0,
            coin_losses: 0,
        })
        .eq('club_id', ctx.clubId);

    if (error) return { error: error.message };

    revalidatePath('/manager/members');
    return { success: true };
}

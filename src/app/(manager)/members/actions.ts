'use server';

import { revalidatePath } from 'next/cache';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getClubRole } from '@/lib/club-auth';
import { isUserAdmin } from '@/lib/auth';
import { cookies } from 'next/headers';



async function getManagerContext() {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const cookieStore = await cookies();
    const activeClubId = cookieStore.get('active_club_id')?.value;
    if (!activeClubId) return null;

    const isSysAdmin = await isUserAdmin(supabase, user);
    let role: string | null = null;

    if (isSysAdmin) {
        const actualRole = await getClubRole(supabase, user.id, activeClubId);
        role = actualRole || 'admin';
    } else {
        const actualRole = await getClubRole(supabase, user.id, activeClubId);
        if (!actualRole || !['owner', 'admin', 'manager'].includes(actualRole)) {
            return null;
        }
        role = actualRole;
    }

    return { user, clubId: activeClubId, role };
}

export type UpdateUserPayload = {
    username?: string | null;
    full_name?: string | null;
    role?: 'owner' | 'admin' | 'manager' | 'member' | 'user' | null;
    skill_level?: string | null;
    gender?: 'M' | 'F' | 'O' | string | null;
}

export async function deleteUser(userId: string) {
    const supabaseAdmin = await getFilteredAdminClient();
    // In a multi-club system, a manager deleting a user should probably only remove them from the club,
    // NOT delete the global user (unless they are the owner and the user belongs to no other clubs).
    // For now, we will delete from club_members.
    try {
        const ctx = await getManagerContext();
        if (!ctx) return { error: '삭제 권한이 없습니다.' };

        const { error } = await (supabaseAdmin as any)
            .from('club_members')
            .delete()
            .eq('club_id', ctx.clubId)
            .eq('user_id', userId);

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
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '수정 권한이 없습니다.' };

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
            .or(`user_id.eq.${userId},id.eq.${userId}`);
        if (error) return { error: error.message };
    }

    // Update club member role
    if (updates.role !== undefined && ['manager', 'member'].includes(updates.role as string)) {
        const clubRole = updates.role === 'manager' ? 'manager' : 'member';
        const { error } = await (supabaseAdmin as any)
            .from('club_members')
            .update({ role: clubRole })
            .eq('club_id', ctx.clubId)
            .eq('user_id', userId);
        if (error) return { error: error.message };
    }

    revalidatePath('/manager/members');
    return { success: true };
}

export async function updateUsersBulk(items: Array<{ userId: string; updates: UpdateUserPayload }>) {
    const ctx = await getManagerContext();
    if (!ctx) return { error: '수정 권한이 없습니다.' };

    for (const item of items) {
        await updateUser(item.userId, item.updates);
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
    const name = fullName.trim();
    if (!name) return `member-${Date.now()}@badminton.local`;
    return `user_${Date.now()}_${Math.floor(Math.random()*1000)}@badminton.local`;
}

export type CreateMemberPayload = {
    full_name: string;
    email?: string | null;
    password?: string | null;
    skill_level?: string | null;
    gender?: 'M' | 'F' | 'O' | string | null;
    role?: 'manager' | 'member' | 'user' | null;
};

export async function createMember(payload: CreateMemberPayload) {
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

    revalidatePath('/manager/members');
    return { success: true };
}

export async function createMembersBulk(payload: { full_names: string; skill_level?: string | null; role?: 'manager' | 'member' | 'user' | null }) {
    const ctx = await getManagerContext();
    if (!ctx) return { error: '추가 권한이 없습니다.' };

    const names = payload.full_names.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
    if (names.length === 0) return { error: '추가할 회원 이름을 입력해 주세요.' };

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const name of names) {
        const result = await createMember({
            full_name: name,
            skill_level: payload.skill_level,
            role: payload.role,
        });

        if (result.error) {
            failCount++;
            results.push({ name, error: result.error });
        } else {
            successCount++;
            results.push({ name, success: true });
        }
    }

    revalidatePath('/manager/members');
    return { success: true, successCount, failCount, results };
}

export async function resetUserPassword(userId: string, newPassword: string) {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '비밀번호 초기화 권한이 없습니다.' };

    if (!newPassword || newPassword.trim().length < 6) {
        return { error: '비밀번호는 최소 6자리 이상이어야 합니다.' };
    }

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, user_id')
        .or(`user_id.eq.${userId},id.eq.${userId}`)
        .maybeSingle();

    if (!profile || !profile.user_id) {
        return { error: '계정을 찾을 수 없습니다.' };
    }

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        profile.user_id,
        { password: newPassword.trim() }
    );

    if (authError) return { error: authError.message };

    return { success: true };
}

export async function resetMemberData(userId: string) {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx) return { error: '초기화 권한이 없습니다.' };

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, user_id')
        .or(`user_id.eq.${userId},id.eq.${userId}`)
        .maybeSingle();

    if (!profile || !profile.user_id) return { error: '계정을 찾을 수 없습니다.' };

    await (supabaseAdmin as any).from('club_members').update({
        coin_wins: 0,
        coin_losses: 0,
        coin_balance: 30
    }).eq('club_id', ctx.clubId).eq('user_id', profile.user_id);

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

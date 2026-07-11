'use server';

import { revalidatePath } from 'next/cache';
import {
    getFilteredAdminClient,
    getSupabaseServerClient,
    getUnfilteredGlobalAdminClient,
} from '@/lib/supabase-server';
import { getClubRole } from '@/lib/club-auth';
import { getUserRole, isAdminRole } from '@/lib/auth';
import { cookies } from 'next/headers';



async function getManagerContext() {
    const supabase = await getSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const cookieStore = await cookies();
    const activeClubId = cookieStore.get('active_club_id')?.value;
    if (!activeClubId) return null;

    // 권한 조회는 RLS에 영향을 받지 않는 서버 전용 클라이언트로 수행합니다.
    // 매니저는 활성 클럽의 소속 역할만 허용하고, 전역 관리자는 모든 클럽을 허용합니다.
    const roleLookupClient = getUnfilteredGlobalAdminClient();
    const globalRole = await getUserRole(roleLookupClient, user);
    if (isAdminRole(globalRole)) {
        return { user, clubId: activeClubId, role: 'admin' };
    }

    const clubRole = await getClubRole(roleLookupClient, user.id, activeClubId);
    if (!clubRole || !['owner', 'admin', 'manager'].includes(clubRole)) {
        return null;
    }

    return { user, clubId: activeClubId, role: clubRole };
}

export async function updateLevelAliases(clubId: string, aliases: Record<string, string>) {
    const supabaseAdmin = await getFilteredAdminClient();
    const ctx = await getManagerContext();
    if (!ctx || ctx.clubId !== clubId) {
        return { error: '수정 권한이 없습니다.' };
    }

    const rows = Object.entries(aliases).map(([code, alias]) => ({
        club_id: clubId,
        level_code: code,
        alias: alias.trim() || code, // fallback to code if empty
    }));

    const { error } = await (supabaseAdmin as any)
        .from('club_level_aliases')
        .upsert(rows, { onConflict: 'club_id,level_code' });

    if (error) {
        return { error: error.message };
    }

    revalidatePath('/manager/settings');
    revalidatePath('/manager/members');
    return { success: true };
}

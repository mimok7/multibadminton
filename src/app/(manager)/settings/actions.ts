'use server';

import { revalidatePath } from 'next/cache';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getClubRole } from '@/lib/club-auth';
import { isUserAdmin } from '@/lib/auth';
import { cookies } from 'next/headers';

const supabaseAdmin = await getFilteredAdminClient();

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

export async function updateLevelAliases(clubId: string, aliases: Record<string, string>) {
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

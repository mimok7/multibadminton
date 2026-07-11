'use server';

import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/superadmin';



export async function getClubsWithMemberCount() {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
        let { data: clubs, error: clubsError } = await (supabaseAdmin as any)
            .from('clubs')
            .select(`
                id,
                name,
                code,
                description,
                phone,
                address,
                manager_name,
                created_at
            `)
            .order('created_at', { ascending: false });

        if (clubsError?.code === '42703') {
            const fallback = await (supabaseAdmin as any)
                .from('clubs')
                .select(`
                    id,
                    name,
                    code,
                    description,
                    created_at
                `)
                .order('created_at', { ascending: false });
            
            clubs = fallback.data;
            clubsError = fallback.error;
        }

        if (clubsError) throw clubsError;

        // Fetch member counts for each club
        const { data: memberCounts, error: countsError } = await (supabaseAdmin as any)
            .from('club_members')
            .select('club_id');

        if (countsError) throw countsError;

        const countMap = new Map<string, number>();
        (memberCounts || []).forEach((m: any) => {
            countMap.set(m.club_id, (countMap.get(m.club_id) || 0) + 1);
        });

        return {
            clubs: (clubs || []).map((c: any) => ({
                ...c,
                member_count: countMap.get(c.id) || 0,
            })),
        };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function createClub(payload: { name: string; code: string; description?: string; phone?: string; address?: string; manager_name?: string }) {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
        const name = payload.name.trim();
        const code = payload.code.trim().toUpperCase();
        const description = payload.description?.trim() || null;
        const phone = payload.phone?.trim() || null;
        const address = payload.address?.trim() || null;
        const manager_name = payload.manager_name?.trim() || null;

        if (!name || !code) {
            return { error: '클럽 이름과 코드를 모두 입력해주세요.' };
        }

        const { data, error } = await (supabaseAdmin as any)
            .from('clubs')
            .insert({
                name,
                code,
                description,
                phone,
                address,
                manager_name,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return { error: '이미 사용 중인 클럽 코드입니다.' };
            }
            // Ignore error for missing columns if SQL is not run yet
            if (error.code === '42703') {
                 const fallback = await (supabaseAdmin as any)
                    .from('clubs')
                    .insert({ name, code, description })
                    .select().single();
                 if (fallback.error) throw fallback.error;
                 revalidatePath('/admin');
                 revalidatePath('/manager/admin');
                 return { success: true, club: fallback.data, warning: 'SQL 마이그레이션이 적용되지 않아 추가 필드가 저장되지 않았습니다.' };
            }
            throw error;
        }

        revalidatePath('/admin');
        revalidatePath('/manager/admin');
        return { success: true, club: data };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function deleteClub(clubId: string) {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
        const { error } = await (supabaseAdmin as any)
            .from('clubs')
            .delete()
            .eq('id', clubId);

        if (error) throw error;
        revalidatePath('/admin');
        revalidatePath('/manager/admin');
        return { success: true };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function getClubLevelAliases(clubId: string) {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
        const { data, error } = await (supabaseAdmin as any)
            .from('club_level_aliases')
            .select('level_code, alias')
            .eq('club_id', clubId);

        if (error) throw error;
        return { aliases: data || [] };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function updateClubLevelAliases(clubId: string, aliases: Record<string, string>) {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
        const rows = Object.entries(aliases).map(([code, alias]) => ({
            club_id: clubId,
            level_code: code,
            alias: alias.trim() || code,
        }));

        const { error } = await (supabaseAdmin as any)
            .from('club_level_aliases')
            .upsert(rows, { onConflict: 'club_id,level_code' });

        if (error) throw error;
        return { success: true };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

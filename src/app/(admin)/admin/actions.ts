'use server';

import { revalidatePath } from 'next/cache';
import { getFilteredAdminClient } from '@/lib/supabase-server';

const supabaseAdmin = await getFilteredAdminClient();

export async function getClubsWithMemberCount() {
    try {
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
                 return { success: true, club: fallback.data, warning: 'SQL 마이그레이션이 적용되지 않아 추가 필드가 저장되지 않았습니다.' };
            }
            throw error;
        }

        revalidatePath('/admin');
        return { success: true, club: data };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function deleteClub(clubId: string) {
    try {
        const { error } = await (supabaseAdmin as any)
            .from('clubs')
            .delete()
            .eq('id', clubId);

        if (error) throw error;
        revalidatePath('/admin');
        return { success: true };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function getClubLevelAliases(clubId: string) {
    try {
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

export async function getClubManagers(clubId: string) {
    try {
        const { data, error } = await (supabaseAdmin as any)
            .from('club_members')
            .select(`
                user_id,
                role,
                profiles (
                    id,
                    full_name,
                    username,
                    email
                )
            `)
            .eq('club_id', clubId)
            .in('role', ['owner', 'admin', 'manager']);

        if (error) throw error;
        
        const managers = (data || []).map((row: any) => ({
            user_id: row.user_id,
            role: row.role,
            full_name: row.profiles?.full_name,
            username: row.profiles?.username,
            email: row.profiles?.email
        }));

        return { managers };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function searchUsers(query: string) {
    try {
        const trimmed = query.trim();
        if (!trimmed) return { users: [] };

        const { data, error } = await supabaseAdmin
            .from('profiles')
            .select('id, full_name, username, email')
            .or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`)
            .limit(10);

        if (error) throw error;
        return { users: data || [] };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function addClubManager(clubId: string, userId: string) {
    try {
        const { error } = await (supabaseAdmin as any)
            .from('club_members')
            .upsert({
                club_id: clubId,
                user_id: userId,
                role: 'manager',
                status: 'active'
            }, { onConflict: 'club_id,user_id' });

        if (error) throw error;
        revalidatePath('/admin');
        return { success: true };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function removeClubManager(clubId: string, userId: string) {
    try {
        const { error } = await (supabaseAdmin as any)
            .from('club_members')
            .delete()
            .eq('club_id', clubId)
            .eq('user_id', userId);

        if (error) throw error;
        revalidatePath('/admin');
        return { success: true };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

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

export async function updateClub(clubId: string, payload: { name: string; code: string; description?: string; phone?: string; address?: string; manager_name?: string }) {
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
            .update({
                name,
                code,
                description,
                phone,
                address,
                manager_name,
            })
            .eq('id', clubId)
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                return { error: '이미 사용 중인 클럽 코드입니다.' };
            }
            if (error.code === '42703') {
                 const fallback = await (supabaseAdmin as any)
                    .from('clubs')
                    .update({ name, code, description })
                    .eq('id', clubId)
                    .select().single();
                 if (fallback.error) throw fallback.error;
                 revalidatePath('/admin');
                 return { success: true, club: fallback.data, warning: 'SQL 마이그레이션이 적용되지 않아 일부 필드가 저장되지 않았습니다.' };
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
        const { supabaseAdmin } = await requireSuperadmin();
        // 1. 해당 클럽에만 속해있는 유저들의 ID 목록 추출
        const { data: members } = await (supabaseAdmin as any)
            .from('club_members')
            .select('user_id')
            .eq('club_id', clubId);
            
        const clubUserIds = members?.map((m: any) => m.user_id).filter(Boolean) || [];
        let userIdsToDelete: string[] = [];

        if (clubUserIds.length > 0) {
            // 다른 클럽에도 가입되어 있는지 확인
            const { data: otherMemberships } = await (supabaseAdmin as any)
                .from('club_members')
                .select('user_id')
                .in('user_id', clubUserIds)
                .neq('club_id', clubId);
                
            const usersInOtherClubs = new Set(otherMemberships?.map((m: any) => m.user_id) || []);
            // 다른 클럽에 속하지 않은(오직 이 클럽에만 있는) 유저들만 프로필 삭제 대상으로 선정
            userIdsToDelete = clubUserIds.filter((id: string) => !usersInOtherClubs.has(id));
        }

        // 2. 관련된 모든 데이터를 삭제할 테이블 목록 (외래키 참조 관계를 고려한 역순 정렬)
        const tablesToDelete = [
            'survey_responses', 'surveys',
            'product_purchases', 'products',
            'member_level_votes', 'member_rating_settings',
            'match_wager_proposals', 'match_coin_bets',
            'team_assignments', 'attendances',
            'match_player_status', 'match_results',
            'challenge_requests',
            'tournament_matches', 'tournaments',
            'match_participants', 'match_schedules', 'match_sessions',
            'generated_matches', 'recurring_match_templates',
            'courts',
            'notifications', 'profile_coin_transactions',
            'club_level_aliases', 'club_members'
        ];

        // 3. 순차적으로 모든 연관 데이터 삭제
        for (const table of tablesToDelete) {
            await (supabaseAdmin as any)
                .from(table)
                .delete()
                .eq('club_id', clubId);
        }

        // 4. 클럽 삭제
        const { error } = await (supabaseAdmin as any)
            .from('clubs')
            .delete()
            .eq('id', clubId);

        if (error) throw error;

        // 5. 이 클럽에만 속해있던 유저들의 프로필(profiles) 정보 삭제
        if (userIdsToDelete.length > 0) {
            // in 조건은 최대 1000개 정도씩 끊어서 하는게 안전하지만 여기서는 그대로 진행
            await (supabaseAdmin as any)
                .from('profiles')
                .delete()
                .in('id', userIdsToDelete);
        }
        revalidatePath('/admin');
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

export async function getClubManagers(clubId: string) {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
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

export async function searchUsers(clubId: string, query: string) {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
        const trimmed = query.trim();
        if (!trimmed) return { users: [] };

        const { data, error } = await supabaseAdmin
            .from('club_members')
            .select(`
                user_id,
                profiles!inner (
                    id,
                    full_name,
                    username,
                    email
                )
            `)
            .eq('club_id', clubId)
            .or(`full_name.ilike.%${trimmed}%,email.ilike.%${trimmed}%`, { foreignTable: 'profiles' })
            .limit(10);

        if (error) throw error;
        
        const users = (data || []).map((row: any) => row.profiles);
        return { users };
    } catch (error: any) {
        return { error: error?.message || JSON.stringify(error) };
    }
}

export async function addClubManager(clubId: string, userId: string) {
    try {
        const { supabaseAdmin } = await requireSuperadmin();
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
        const { supabaseAdmin } = await requireSuperadmin();
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

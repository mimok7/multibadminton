'use server';

import { revalidatePath } from 'next/cache';
import { getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';
import { requireSuperadmin } from '@/lib/superadmin';
import { readCoinSettings } from '@/lib/coin-settings';
import { DEFAULT_COIN_SETTINGS } from '@/lib/coins';

// 사용자를 삭제하려면 서비스 키를 사용하는 별도의 관리자 클라이언트가 필요합니다.
// 이 키는 절대로 노출되어서는 안 됩니다.


async function isAdmin() {
    try {
        await requireSuperadmin();
        return true;
    } catch {
        return false;
    }
}

export async function deleteUser(userId: string) {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    try {
        if (!(await isAdmin())) {
            return { error: '삭제 권한이 없습니다.' };
        }

        const profileLookup = await supabaseAdmin
            .from('profiles')
            .select('id, user_id, updated_at')
            .or(`user_id.eq.${userId},id.eq.${userId}`)
            .order('updated_at', { ascending: false });

        if (profileLookup.error) {
            return { error: profileLookup.error.message };
        }

        const matchedProfiles = (profileLookup.data || []) as Array<{ id: string; user_id: string | null }>;
        const targetProfile =
            matchedProfiles.find((profile) => profile.user_id === userId) ||
            matchedProfiles.find((profile) => profile.id === userId) ||
            matchedProfiles[0];

        if (!targetProfile) {
            return { error: '대상 사용자를 찾을 수 없습니다.' };
        }

        let warning: string | null = null;

        if (targetProfile.user_id) {
            // auth.users 삭제가 가능한 경우에는 auth 쪽을 먼저 지웁니다.
            const authDelete = await supabaseAdmin.auth.admin.deleteUser(targetProfile.user_id);

            if (authDelete.error) {
                warning = authDelete.error.message;

                // auth 삭제가 막힌 경우에도 관리자 화면에서는 확실히 제거되도록
                // 프로필을 직접 삭제하는 fallback을 수행합니다.
                const fallbackDelete = await supabaseAdmin
                    .from('profiles')
                    .delete()
                    .eq('id', targetProfile.id);

                if (fallbackDelete.error) {
                    return { error: fallbackDelete.error.message };
                }
            }
        } else {
            const { error } = await supabaseAdmin
                .from('profiles')
                .delete()
                .eq('id', targetProfile.id);

            if (error) {
                return { error: error.message };
            }
        }

        revalidatePath('/admin/members');
        return warning ? { success: true, warning } : { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : '사용자 삭제 중 알 수 없는 오류가 발생했습니다.';
        return { error: message };
    }
}

function normalizeGlobalProfileRole(role?: string | null): 'superadmin' | 'member' {
    return ['admin', 'superadmin', 'administrator'].includes(String(role || '').trim().toLowerCase())
        ? 'superadmin'
        : 'member';
}

export type UpdateUserPayload = {
    username?: string | null;
    full_name?: string | null;
    role?: 'superadmin' | 'member' | 'admin' | 'manager' | 'user' | null;
    skill_level?: string | null;
    gender?: 'M' | 'F' | 'O' | string | null;
}

export async function updateUser(userId: string, updates: UpdateUserPayload) {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    if (!(await isAdmin())) {
        return { error: '수정 권한이 없습니다.' };
    }

    // 정리: 빈 문자열은 null로 보정
    const payload: Record<string, any> = {}
    if (updates.username !== undefined) payload.username = updates.username || null
    if (updates.full_name !== undefined) payload.full_name = updates.full_name || null
        if (updates.role !== undefined) payload.role = normalizeGlobalProfileRole(updates.role)
    if (updates.skill_level !== undefined) payload.skill_level = updates.skill_level || null
    if (updates.gender !== undefined) payload.gender = updates.gender || null

    // 1차: user_id 기준 업데이트
    const first = await supabaseAdmin
        .from('profiles')
        .update(payload)
        .eq('user_id', userId)
        .select('id')

    if (first.error) {
        return { error: first.error.message }
    }

    // 변경 행이 없는 경우 id 기준으로 재시도 (스키마 차이 대응)
    if (!first.data || first.data.length === 0) {
        const second = await supabaseAdmin
            .from('profiles')
            .update(payload)
            .eq('id', userId)
            .select('id')

        if (second.error) {
            return { error: second.error.message }
        }

        if (!second.data || second.data.length === 0) {
            return { error: '대상 사용자를 찾을 수 없습니다.' }
        }
    }

    revalidatePath('/admin/members')
    return { success: true }
}

export async function updateUsersBulk(
    items: Array<{ userId: string; updates: UpdateUserPayload }>
) {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    if (!(await isAdmin())) {
        return { error: '수정 권한이 없습니다.' };
    }

    if (!Array.isArray(items) || items.length === 0) {
        return { success: true, updatedCount: 0 };
    }

    for (const item of items) {
        const userId = item?.userId;
        const updates = item?.updates;

        if (!userId || !updates) {
            return { error: '잘못된 전체 저장 요청입니다.' };
        }

        const payload: Record<string, any> = {};
        if (updates.username !== undefined) payload.username = updates.username || null;
        if (updates.full_name !== undefined) payload.full_name = updates.full_name || null;
        if (updates.role !== undefined) payload.role = normalizeGlobalProfileRole(updates.role);
        if (updates.skill_level !== undefined) payload.skill_level = updates.skill_level || null;
        if (updates.gender !== undefined) payload.gender = updates.gender || null;

        const first = await supabaseAdmin
            .from('profiles')
            .update(payload)
            .eq('user_id', userId)
            .select('id');

        if (first.error) {
            return { error: first.error.message };
        }

        if (!first.data || first.data.length === 0) {
            const second = await supabaseAdmin
                .from('profiles')
                .update(payload)
                .eq('id', userId)
                .select('id');

            if (second.error) {
                return { error: second.error.message };
            }

            if (!second.data || second.data.length === 0) {
                return { error: '대상 사용자 중 일부를 찾을 수 없습니다.' };
            }
        }
    }

    revalidatePath('/admin/members');
    return { success: true, updatedCount: items.length };
}

export async function resetAttendanceAll() {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    if (!(await isAdmin())) {
        return { error: '권한이 없습니다.' };
    }
    
    const { error } = await supabaseAdmin
        .from('attendances')
        .delete()
        .not('id', 'is', null);
        
    if (error) {
        return { error: error.message };
    }
    
    revalidatePath('/admin/members');
    return { success: true };
}

export async function resetWinRateAll() {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    if (!(await isAdmin())) {
        return { error: '권한이 없습니다.' };
    }
    
    const { error } = await supabaseAdmin
        .from('profiles')
        .update({
            coin_wins: 0,
            coin_losses: 0,
        })
        .not('id', 'is', null);
        
    if (error) {
        return { error: error.message };
    }
    
    revalidatePath('/admin/members');
    return { success: true };
}

function romanizeSyllable(char: string): string {
    const customSyllables: Record<string, string> = {
        '유': 'yoo', '우': 'woo', '이': 'lee', '임': 'lim', '성': 'sung',
        '정': 'jung', '영': 'young', '현': 'hyun', '설': 'seol', '경': 'kyung',
        '석': 'seok', '최': 'choi', '박': 'park', '김': 'kim', '조': 'cho',
        '윤': 'yoon', '민': 'min', '신': 'shin', '서': 'seo', '한': 'han',
        '오': 'oh', '강': 'kang', '송': 'song', '황': 'hwang', '안': 'ahn',
        '홍': 'hong', '고': 'koh', '문': 'moon', '양': 'yang', '배': 'bae',
        '백': 'baek', '허': 'hur', '남': 'nam', '심': 'shim', '노': 'noh',
        '하': 'ha', '곽': 'kwak', '철': 'chul', '수': 'soo', '준': 'jun',
        '호': 'ho', '재': 'jae', '원': 'won', '희': 'hee', '진': 'jin',
        '태': 'tae', '예': 'ye', '훈': 'hoon', '은': 'eun', '혜': 'hye',
        '지': 'ji', '연': 'yeon', '선': 'seon', '욱': 'wook', '식': 'sik',
        '환': 'hwan', '건': 'geon', '찬': 'chan', '국': 'gook', '동': 'dong',
        '규': 'kyu', '범': 'beom', '상': 'sang', '기': 'ki', '승': 'seung',
        '용': 'yong', '덕': 'deok', '학': 'hak', '주': 'joo'
    };

    if (customSyllables[char]) return customSyllables[char];

    const code = char.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
        const sIndex = code - 0xAC00;
        const tIndex = sIndex % 28;
        const vIndex = ((sIndex - tIndex) / 28) % 21;
        const lIndex = Math.floor((sIndex - tIndex) / 28 / 21);

        const cho = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
        const jung = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
        const jong = ['', 'g', 'kk', 'gs', 'n', 'nj', 'nh', 'd', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'b', 'bs', 's', 'ss', 'ng', 'j', 'ch', 'k', 't', 'p', 'h'];

        const c = cho[lIndex];
        let v = jung[vIndex];
        const j = jong[tIndex];

        if (c === '' && v === 'yu') v = 'yoo';
        if (c === '' && v === 'u') v = 'woo';
        if (v === 'eo') v = 'eo';

        return c + v + j;
    }
    return char.toLowerCase();
}

function buildAutoEmail(fullName: string): string {
    const name = fullName.trim();
    if (!name) return `member-${Date.now()}@badminton.local`;

    if (/^[a-zA-Z0-9_ -]+$/.test(name)) {
        return `${name.toLowerCase().replace(/[\s-]+/g, '_')}@badminton.local`;
    }

    if (name.length >= 2) {
        const familyName = name[0];
        const givenName = name.slice(1);
        
        const romFamily = romanizeSyllable(familyName);
        let romGiven = '';
        for (let i = 0; i < givenName.length; i++) {
            romGiven += romanizeSyllable(givenName[i]);
        }
        
        return `${romFamily}_${romGiven}@badminton.local`;
    }
    
    let rom = '';
    for (let i = 0; i < name.length; i++) {
        rom += romanizeSyllable(name[i]);
    }
    return `${rom}@badminton.local`;
}

export type CreateMemberPayload = {
    full_name: string;
    email?: string | null;
    password?: string | null;
    skill_level?: string | null;
    gender?: 'M' | 'F' | 'O' | string | null;
    role?: 'superadmin' | 'member' | 'admin' | 'manager' | 'user' | null;
};

export async function createMember(payload: CreateMemberPayload) {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    if (!(await isAdmin())) {
        return { error: '추가 권한이 없습니다.' };
    }

    const fullName = payload.full_name.trim();
    const email = (payload.email && payload.email.trim()) || buildAutoEmail(fullName);
    const password = (payload.password || 'bad123!').trim();

    if (!fullName) {
        return { error: '이름을 입력해 주세요.' };
    }

    if (!email) {
        return { error: '이메일을 입력해 주세요.' };
    }

    // 1. Supabase Auth 계정 생성
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true
    });

    if (authError) {
        return { error: `인증 계정 생성 실패: ${authError.message}` };
    }

    if (!authUser.user) {
        return { error: '인증 계정 생성 결과가 유효하지 않습니다.' };
    }

    // 2. 트리거에 의해 생성/연결된 프로필 업데이트
    const updatePayload = {
        username: fullName,
        full_name: fullName,
        role: normalizeGlobalProfileRole(payload.role),
        skill_level: payload.skill_level || 'E2',
        gender: payload.gender || null,
    };

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update(updatePayload)
        .eq('user_id', authUser.user.id)
        .select('id, user_id, username, full_name, role, skill_level, gender, email, updated_at')
        .single();


    if (error) {
        return { error: `프로필 정보 설정 실패: ${error.message}` };
    }

    revalidatePath('/admin/members');
    return { success: true, member: data };
}

export async function updateRatingSettings(startDate: string | null, endDate: string | null) {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    if (!(await isAdmin())) {
        return { error: '설정 권한이 없습니다.' };
    }

    const { error } = await (supabaseAdmin as any)
        .from('member_rating_settings')
        .upsert({
            id: 1,
            start_date: startDate ? new Date(startDate).toISOString() : null,
            end_date: endDate ? new Date(endDate).toISOString() : null,
            updated_at: new Date().toISOString()
        }, { onConflict: 'id' });

    if (error) {
        return { error: error.message };
    }

    revalidatePath('/admin/members');
    revalidatePath('/profile');
    return { success: true };
}

export async function resetUserPassword(userId: string, newPassword: string) {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    try {
        if (!(await isAdmin())) {
            return { error: '비밀번호 초기화 권한이 없습니다.' };
        }

        if (!newPassword || newPassword.trim().length < 6) {
            return { error: '비밀번호는 최소 6자리 이상이어야 합니다.' };
        }

        // 1. 프로필 찾기
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, user_id')
            .or(`user_id.eq.${userId},id.eq.${userId}`)
            .maybeSingle();

        if (profileError) {
            return { error: profileError.message };
        }

        if (!profile || !profile.user_id) {
            return { error: '로그인 계정이 연동되지 않은 회원은 비밀번호를 초기화할 수 없습니다.' };
        }

        // 2. Auth 유저 비밀번호 업데이트
        const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
            profile.user_id,
            { password: newPassword.trim() }
        );

        if (authError) {
            return { error: authError.message };
        }

        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : '비밀번호 초기화 중 알 수 없는 오류가 발생했습니다.';
        return { error: message };
    }
}

export async function resetMemberData(userId: string) {
    const supabaseAdmin = getUnfilteredGlobalAdminClient();
    try {
        if (!(await isAdmin())) {
            return { error: '초기화 권한이 없습니다.' };
        }

        // 1. 프로필 찾기
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, user_id')
            .or(`user_id.eq.${userId},id.eq.${userId}`)
            .maybeSingle();

        if (profileError) {
            return { error: profileError.message };
        }

        if (!profile) {
            return { error: '대상 사용자를 찾을 수 없습니다.' };
        }

        // 2. 출석 데이터 삭제
        const { error: attendanceError } = await supabaseAdmin
            .from('attendances')
            .delete()
            .eq('user_id', profile.id);

        if (attendanceError) {
            return { error: `출석 초기화 실패: ${attendanceError.message}` };
        }

        // 3. 코인 설정 읽어서 초기 코인 잔액 가져오기
        const coinSettings = await readCoinSettings().catch(() => DEFAULT_COIN_SETTINGS);
        const initialBalance = coinSettings.initialCoinBalance;

        // 4. 프로필 코인 정보 및 전적 초기화
        const { error: updateError } = await supabaseAdmin
            .from('profiles')
            .update({
                coin_wins: 0,
                coin_losses: 0,
                coin_balance: initialBalance,
            })
            .eq('id', profile.id);

        if (updateError) {
            return { error: `전적/코인 초기화 실패: ${updateError.message}` };
        }

        revalidatePath('/admin/members');
        return { success: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : '사용자 초기화 중 알 수 없는 오류가 발생했습니다.';
        return { error: message };
    }
}



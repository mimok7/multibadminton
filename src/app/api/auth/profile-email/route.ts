import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type ProfileLookupRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  user_id: string | null;
  club_members?: Array<{
    clubs: { id: string; name: string } | Array<{ id: string; name: string }> | null;
  }> | null;
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fullName = searchParams.get('fullName')?.trim();

    if (!fullName) {
      return NextResponse.json(
        { error: 'fullName is required' },
        { status: 400 }
      );
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Supabase server configuration is missing' },
        { status: 500 }
      );
    }

    const supabaseAdmin = getUnfilteredGlobalAdminClient();

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select(`
        id,
        full_name,
        username,
        user_id,
        club_members (
          club_id,
          clubs (
            id,
            name
          )
        )
      `)
      .eq('full_name', fullName);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to look up profile email' },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'No profile found for the provided full name' },
        { status: 404 }
      );
    }

    const profiles = (data as unknown as ProfileLookupRow[]).map((profile) => {
      // Format clubs
      const clubs = (profile.club_members || []).flatMap((membership) => {
        if (!membership.clubs) return [];
        return Array.isArray(membership.clubs) ? membership.clubs : [membership.clubs];
      });

      return {
        id: profile.id,
        fullName: profile.full_name,
        username: profile.username ?? '',
        hasLinkedUser: Boolean(profile.user_id),
        clubs: clubs
      };
    });

    return NextResponse.json({ profiles });
  } catch {
    return NextResponse.json(
      { error: 'Unexpected profile lookup error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const profileId = String(body?.profileId || '').trim();
    const password = String(body?.password || '');
    if (!profileId || !password) {
      return NextResponse.json({ error: '계정과 비밀번호를 입력해 주세요.' }, { status: 400 });
    }

    const admin = getUnfilteredGlobalAdminClient();
    const { data: profile } = await admin
      .from('profiles')
      .select('id, user_id, email')
      .eq('id', profileId)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    let loginEmail = profile.email || '';
    if (!loginEmail && profile.user_id) {
      const { data } = await admin.auth.admin.getUserById(profile.user_id);
      loginEmail = data.user?.email || '';
    }
    if (!loginEmail) {
      return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    const supabase = await getSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (error || !data.user || !data.session) {
      return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    if (profile.user_id && profile.user_id !== data.user.id && profile.id !== data.user.id) {
      await supabase.auth.signOut();
      return NextResponse.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 });
    }

    return NextResponse.json({
      user: data.user,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch {
    return NextResponse.json({ error: '로그인 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

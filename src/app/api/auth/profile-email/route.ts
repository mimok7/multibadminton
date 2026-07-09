import { NextResponse } from 'next/server';
import { getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

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
        email,
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

    const profiles = await Promise.all(data.map(async (profile: any) => {
      let resolvedEmail = profile.email ?? '';

      if (!resolvedEmail && profile.user_id) {
        const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(profile.user_id);
        if (!authUserError) {
          resolvedEmail = authUserData.user?.email ?? '';
        }
      }

      // Format clubs
      const clubs = profile.club_members
        ?.map((cm: any) => cm.clubs)
        .filter(Boolean) || [];

      return {
        id: profile.id,
        fullName: profile.full_name,
        email: resolvedEmail,
        username: profile.username ?? '',
        hasLinkedUser: Boolean(profile.user_id),
        clubs: clubs
      };
    }));

    return NextResponse.json({ profiles });
  } catch (error) {
    return NextResponse.json(
      { error: 'Unexpected profile lookup error' },
      { status: 500 }
    );
  }
}

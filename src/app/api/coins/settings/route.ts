import { NextResponse } from 'next/server';
import { readCoinSettings } from '@/lib/coin-settings';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function GET() {
  try {
    const serverSupabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await serverSupabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ isCoinEnabled: false });
    }

    const clubId = await getActiveClubId();
    if (!clubId) {
      return NextResponse.json({ isCoinEnabled: false });
    }

    const coinSettings = await readCoinSettings();
    return NextResponse.json({
      isCoinEnabled: coinSettings.isCoinEnabled,
    });
  } catch (error) {
    console.error('Failed to load coin settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

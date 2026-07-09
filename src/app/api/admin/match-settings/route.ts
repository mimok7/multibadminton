import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/auth';
import { readMatchSettings, writeMatchSettings } from '@/lib/match-settings';

async function requireAdmin() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!(await isUserAdmin(supabase, user))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { supabase, user };
}

export async function GET() {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) {
      return adminContext.error;
    }

    const settings = await readMatchSettings();
    return NextResponse.json(settings);
  } catch (error) {
    console.error('Failed to get match settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) {
      return adminContext.error;
    }

    const body = await request.json().catch(() => ({}));
    const autoGenerateEnabled = typeof body.autoGenerateEnabled === 'boolean' ? body.autoGenerateEnabled : false;

    const newSettings = await writeMatchSettings({ autoGenerateEnabled });
    return NextResponse.json(newSettings);
  } catch (error) {
    console.error('Failed to update match settings:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

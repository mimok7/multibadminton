import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole } from '@/lib/auth';

async function requireAdminOrManager() {
  const supabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const userRole = await getUserRole(supabase, user);
  if (!userRole || !['admin', 'manager'].includes(userRole)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { adminSupabase };
}

export async function PUT(request: Request) {
  try {
    const adminContext = await requireAdminOrManager();
    if ('error' in adminContext) {
      return adminContext.error;
    }

    const payload = await request.json().catch(() => null);
    if (!payload || !Array.isArray(payload.matches)) {
      return NextResponse.json({ error: 'Invalid payload, matches array is required' }, { status: 400 });
    }

    const { matches } = payload;
    
    for (const m of matches) {
      if (!m.id) continue;
      
      const updateData: any = {};
      if (m.court !== undefined) updateData.court = m.court || null;
      if (m.scheduled_time !== undefined) updateData.scheduled_time = m.scheduled_time || null;
      if (m.match_number !== undefined) updateData.match_number = m.match_number;
      if (m.round !== undefined) updateData.round = m.round;

      const { error } = await adminContext.adminSupabase
        .from('tournament_matches')
        .update(updateData)
        .eq('id', m.id);
        
      if (error) {
        console.error('Match update error for id:', m.id, error);
        throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Batch update error:', error);
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

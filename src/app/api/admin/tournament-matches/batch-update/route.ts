import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';

async function requireAdminOrManager() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status }) };
  }
  return context;
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

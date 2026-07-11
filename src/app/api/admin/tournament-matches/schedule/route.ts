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

export async function PATCH(request: Request) {
  try {
    const adminContext = await requireAdminOrManager();
    if ('error' in adminContext) {
      return adminContext.error;
    }

    const payload = await request.json().catch(() => null);
    const { match_id, court, scheduled_time } = payload || {};

    if (!match_id) {
      return NextResponse.json({ error: 'match_id is required' }, { status: 400 });
    }

    const { error } = await adminContext.adminSupabase
      .from('tournament_matches')
      .update({
        court: court || null,
        scheduled_time: scheduled_time || null
      })
      .eq('id', match_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Unexpected server error', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

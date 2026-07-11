import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';

type CreateRecurringTemplatePayload = {
  club_id?: string;
  name?: string;
  description?: string;
  day_of_weeks?: number[];
  start_time?: string;
  end_time?: string;
  location?: string;
  max_participants?: number;
  advance_days?: number;
};

type UpdateRecurringTemplatePayload = {
  id: string;
  name?: string;
  description?: string | null;
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  location?: string;
  max_participants?: number;
  advance_days?: number;
  is_active?: boolean;
};

const VALID_DAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

async function requireManager() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status }) };
  }
  return context;
}

export async function POST(req: Request) {
  try {
    const context = await requireManager();
    if ('error' in context) return context.error;
    const { adminSupabase, user, clubId } = context;

    const body = (await req.json()) as CreateRecurringTemplatePayload;
    const requestedClubId = body.club_id;
    const name = body.name?.trim();
    const description = body.description?.trim() || null;
    const location = body.location?.trim();
    const startTime = body.start_time;
    const endTime = body.end_time;
    const maxParticipants = body.max_participants;
    const advanceDays = body.advance_days;
    const dayOfWeeks = Array.from(
      new Set((body.day_of_weeks || []).filter((day): day is number => VALID_DAYS.has(day)))
    ).sort((a, b) => a - b);

    if (!name || !location || !startTime || !endTime || dayOfWeeks.length === 0 || !requestedClubId || requestedClubId !== clubId) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const rows = dayOfWeeks.map((dayOfWeek) => ({
      club_id: clubId,
      name,
      description,
      day_of_week: dayOfWeek,
      start_time: startTime,
      end_time: endTime,
      location,
      max_participants: maxParticipants ?? 20,
      advance_days: advanceDays ?? 7,
      is_active: true,
      created_by: user.id,
    }));

    const { error: insertError } = await adminSupabase
      .from('recurring_match_templates')
      .insert(rows);

    if (insertError) {
      console.error('Recurring template insert error:', insertError);
      return NextResponse.json({ error: 'Failed to create templates', details: insertError }, { status: 500 });
    }

    return NextResponse.json({ created: rows.length });
  } catch (error: any) {
    console.error('Recurring template API error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const context = await requireManager();
    if ('error' in context) return context.error;
    const { adminSupabase } = context;

    const body = (await req.json()) as UpdateRecurringTemplatePayload;
    const { id, ...updateFields } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing template ID' }, { status: 400 });
    }

    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    if (updateFields.name !== undefined) updateData.name = updateFields.name.trim();
    if (updateFields.description !== undefined) updateData.description = updateFields.description?.trim() || null;
    if (updateFields.day_of_week !== undefined && VALID_DAYS.has(updateFields.day_of_week)) updateData.day_of_week = updateFields.day_of_week;
    if (updateFields.start_time !== undefined) updateData.start_time = updateFields.start_time;
    if (updateFields.end_time !== undefined) updateData.end_time = updateFields.end_time;
    if (updateFields.location !== undefined) updateData.location = updateFields.location.trim();
    if (updateFields.max_participants !== undefined) updateData.max_participants = updateFields.max_participants;
    if (updateFields.advance_days !== undefined) updateData.advance_days = updateFields.advance_days;
    if (updateFields.is_active !== undefined) updateData.is_active = updateFields.is_active;

    const { error: updateError } = await adminSupabase
      .from('recurring_match_templates')
      .update(updateData)
      .eq('id', id);

    if (updateError) {
      console.error('Recurring template update error:', updateError);
      return NextResponse.json({ error: 'Failed to update template', details: updateError }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Recurring template PUT API error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const context = await requireManager();
    if ('error' in context) return context.error;
    const { adminSupabase } = context;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing template ID' }, { status: 400 });
    }

    const { error: deleteError } = await adminSupabase
      .from('recurring_match_templates')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Recurring template delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete template', details: deleteError }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Recurring template DELETE API error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const context = await requireManager();
    if ('error' in context) return context.error;
    const { adminSupabase, clubId: activeClubId } = context;

    const { searchParams } = new URL(req.url);
    const requestedClubId = searchParams.get('club_id');

    if (!requestedClubId || requestedClubId !== activeClubId) {
      return NextResponse.json({ error: 'Missing club_id' }, { status: 400 });
    }

    const { data: templates, error: fetchError } = await adminSupabase
      .from('recurring_match_templates')
      .select('*')
      .eq('club_id', activeClubId)
      .order('day_of_week')
      .order('start_time');

    if (fetchError) {
      console.error('Recurring template fetch error:', fetchError);
      return NextResponse.json({ error: 'Failed to fetch templates', details: fetchError }, { status: 500 });
    }

    return NextResponse.json({ templates: templates || [] });
  } catch (error: any) {
    console.error('Recurring template GET API error:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}

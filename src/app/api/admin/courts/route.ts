import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';
import type { Database } from '@/types/supabase';

type CourtInsert = Database['public']['Tables']['courts']['Insert'];
type CourtUpdate = Database['public']['Tables']['courts']['Update'];

async function requireAdmin() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status }) };
  }
  return context;
}

export async function GET() {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) return adminContext.error;

    const { data, error } = await adminContext.adminSupabase
      .from('courts')
      .select('id, name, is_active, order_index, location')
      .order('order_index', { ascending: true, nullsFirst: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('Admin courts GET error:', error);
      return NextResponse.json({ error: 'Failed to load courts' }, { status: 500 });
    }

    return NextResponse.json({ courts: data || [] });
  } catch (error) {
    console.error('Admin courts GET unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) return adminContext.error;

    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const location = typeof body?.location === 'string' ? body.location.trim() : '';
    const isActive = typeof body?.is_active === 'boolean' ? body.is_active : true;
    const orderIndex = Number.isFinite(Number(body?.order_index)) ? Number(body.order_index) : null;

    if (!name) {
      return NextResponse.json({ error: 'Court name is required' }, { status: 400 });
    }

    const payload: CourtInsert = {
      name,
      is_active: isActive,
    };

    if (location) payload.location = location;
    if (orderIndex !== null) payload.order_index = orderIndex;

    const { data, error } = await adminContext.adminSupabase
      .from('courts')
      .insert(payload)
      .select('id, name, is_active, order_index, location')
      .single();

    if (error) {
      console.error('Admin courts POST error:', error);
      return NextResponse.json({ error: 'Failed to create court' }, { status: 500 });
    }

    return NextResponse.json({ court: data });
  } catch (error) {
    console.error('Admin courts POST unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) return adminContext.error;

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id : '';

    if (!id) {
      return NextResponse.json({ error: 'Court id is required' }, { status: 400 });
    }

    const updates: CourtUpdate = {};

    if (typeof body?.name === 'string') updates.name = body.name.trim();
    if (typeof body?.location === 'string') updates.location = body.location.trim();
    if (typeof body?.is_active === 'boolean') updates.is_active = body.is_active;
    if (Number.isFinite(Number(body?.order_index))) updates.order_index = Number(body.order_index);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    const { data, error } = await adminContext.adminSupabase
      .from('courts')
      .update(updates)
      .eq('id', id)
      .select('id, name, is_active, order_index, location')
      .single();

    if (error) {
      console.error('Admin courts PATCH error:', error);
      return NextResponse.json({ error: 'Failed to update court' }, { status: 500 });
    }

    return NextResponse.json({ court: data });
  } catch (error) {
    console.error('Admin courts PATCH unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const adminContext = await requireAdmin();
    if ('error' in adminContext) return adminContext.error;

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id : '';

    if (!id) {
      return NextResponse.json({ error: 'Court id is required' }, { status: 400 });
    }

    const { error } = await adminContext.adminSupabase.from('courts').delete().eq('id', id);

    if (error) {
      console.error('Admin courts DELETE error:', error);
      return NextResponse.json({ error: 'Failed to delete court' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Admin courts DELETE unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

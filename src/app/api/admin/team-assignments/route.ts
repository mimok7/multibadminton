import { NextResponse } from 'next/server';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole } from '@/lib/auth';

async function requireAdmin() {
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

export async function GET() {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const { data, error } = await adminContext.adminSupabase
      .from('team_assignments')
      .select('*')
      .order('assignment_date', { ascending: false });

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to fetch team assignments',
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ teamAssignments: data || [] });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const payload = await request.json().catch(() => null);

    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const assignmentToInsert = payload as any;

    const { error } = await adminContext.adminSupabase
      .from('team_assignments')
      .insert(assignmentToInsert);

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to save team assignments',
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const adminContext = await requireAdmin();

    if ('error' in adminContext) {
      return adminContext.error;
    }

    const payload = await request.json().catch(() => null);
    const assignmentId = String((payload as { assignmentId?: unknown })?.assignmentId || '').trim();

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId is required' }, { status: 400 });
    }

    const { error } = await adminContext.adminSupabase
      .from('team_assignments')
      .delete()
      .eq('id', assignmentId);

    if (error) {
      return NextResponse.json(
        {
          error: 'Failed to delete team assignment',
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, assignmentId });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unexpected server error',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

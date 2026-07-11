import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';
import { readMatchSettings, writeMatchSettings } from '@/lib/match-settings';

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

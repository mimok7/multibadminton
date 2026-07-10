import { NextResponse } from 'next/server';
import { getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';
import fs from 'fs';
import path from 'path';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/auth';

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const serverSupabase = await getSupabaseServerClient();
  const { data: { user } } = await serverSupabase.auth.getUser();
  if (!user || !(await isUserAdmin(serverSupabase, user))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getUnfilteredGlobalAdminClient();
  try {
    const sqlPath = path.join(process.cwd(), 'sql', '01_club_level_aliases.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // We cannot execute raw SQL from Supabase JS easily if the exec_sql RPC is not installed.
    // Let's use inline plpgsql via an RPC if it exists, otherwise we'll have to tell the user to run it.
    const { error } = await (supabase as any).rpc('inline_code_block', { sql_query: sql });
    if (error) throw error;
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

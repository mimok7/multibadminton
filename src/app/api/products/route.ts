import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getFilteredAdminClient } from '@/lib/supabase-server';

export async function GET() {
  const serverSupabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminSupabase = await getFilteredAdminClient() as any;
  const { data: products, error } = await adminSupabase
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: products || [] });
}

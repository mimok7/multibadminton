import { NextResponse } from 'next/server';
import { getSupabaseServerClient, getClubScopedAdminClient } from '@/lib/supabase-server';
import { getActiveClubId } from '@/lib/club';

export async function GET() {
  const serverSupabase = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clubId = await getActiveClubId();
  if (!clubId) {
    return NextResponse.json({ products: [] });
  }

  const adminSupabase = await getClubScopedAdminClient(clubId) as any;
  const { data: products, error } = await adminSupabase
    .from('products')
    .select('id, name, coin_price, description, image_svg, is_active, created_at, updated_at')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ products: products || [] });
}

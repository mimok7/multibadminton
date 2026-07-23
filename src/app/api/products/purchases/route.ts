import { NextResponse } from 'next/server';
import { getProfileByUserId } from '@/lib/auth';
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

  const profile = await getProfileByUserId(serverSupabase, user.id);
  if (!profile) {
    return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
  }

  const clubId = await getActiveClubId();
  if (!clubId) {
    return NextResponse.json({ purchases: [] });
  }

  const adminSupabase = await getClubScopedAdminClient(clubId) as any;
  const { data: purchases, error } = await adminSupabase
    .from('product_purchases')
    .select(`
      id,
      profile_id,
      product_id,
      coin_price,
      created_at,
      products:product_id(name)
    `)
    .eq('profile_id', profile.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const formattedPurchases = (purchases || []).map((p: any) => ({
    id: p.id,
    profile_id: p.profile_id,
    product_id: p.product_id,
    coin_price: p.coin_price,
    created_at: p.created_at,
    product_name: p.products?.name || '삭제된 상품',
  }));

  return NextResponse.json({ purchases: formattedPurchases });
}

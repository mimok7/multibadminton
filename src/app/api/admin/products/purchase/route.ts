import { NextResponse } from 'next/server';
import { getProfileByUserId, isAdminRole } from '@/lib/auth';
import { getFilteredAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

async function requireAdmin() {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = await getFilteredAdminClient() as any;
  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);
  if (!currentProfile || !isAdminRole(currentProfile.role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { adminSupabase, currentProfile };
}

export async function POST(request: Request) {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase } = context;
  const body = await request.json().catch(() => null);

  const profileId = String(body?.profile_id || '');
  const productId = String(body?.product_id || '');

  if (!profileId || !productId) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  try {
    // 1. 상품 및 사용자 잔액 조회
    const [productRes, profileRes] = await Promise.all([
      adminSupabase.from('products').select('*').eq('id', productId).single(),
      adminSupabase.from('profiles').select('coin_balance').eq('id', profileId).single(),
    ]);

    if (productRes.error || !productRes.data) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (profileRes.error || !profileRes.data) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    const product = productRes.data;
    const profile = profileRes.data;

    if (!product.is_active) {
      return NextResponse.json({ error: '비활성화된 상품입니다.' }, { status: 400 });
    }

    if ((profile.coin_balance ?? 0) < product.coin_price) {
      return NextResponse.json({ error: '사용자의 코인이 부족하여 교환할 수 없습니다.' }, { status: 400 });
    }

    const nextBalance = (profile.coin_balance ?? 0) - product.coin_price;

    // 2. 코인 차감 업데이트
    const { error: updateError } = await adminSupabase
      .from('profiles')
      .update({
        coin_balance: nextBalance,
        coin_updated_at: new Date().toISOString(),
      })
      .eq('id', profileId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    // 3. 구매 기록 등록
    let purchaseError: any = null;
    const { error: firstInsertError } = await adminSupabase
      .from('product_purchases')
      .insert({
        profile_id: profileId,
        product_id: productId,
        coin_price: product.coin_price,
        status: 'completed',
      });

    if (firstInsertError) {
      const errMsg = firstInsertError.message || '';
      if (errMsg.includes('status') && (errMsg.includes('does not exist') || errMsg.includes('column'))) {
        // status 컬럼이 없는 경우 fallback
        const { error: secondInsertError } = await adminSupabase
          .from('product_purchases')
          .insert({
            profile_id: profileId,
            product_id: productId,
            coin_price: product.coin_price,
          });
        purchaseError = secondInsertError;
      } else {
        purchaseError = firstInsertError;
      }
    }

    if (purchaseError) {
      // 롤백 (단순 수동 롤백)
      await adminSupabase
        .from('profiles')
        .update({
          coin_balance: profile.coin_balance ?? 0,
          coin_updated_at: new Date().toISOString(),
        })
        .eq('id', profileId);
      throw new Error(purchaseError.message);
    }

    return NextResponse.json({ success: true, nextBalance });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '상품 구매 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

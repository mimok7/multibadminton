import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';

async function requireAdmin() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: status === 401 ? 'Unauthorized' : status === 400 ? 'Club not selected' : 'Forbidden' }, { status }) };
  }
  return context;
}

export async function POST(request: Request) {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase, clubId } = context;
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
      adminSupabase
        .from('club_members')
        .select('coin_balance')
        .eq('club_id', clubId)
        .eq('user_id', profileId)
        .eq('status', 'active')
        .single(),
    ]);

    if (productRes.error || !productRes.data) {
      return NextResponse.json({ error: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    if (profileRes.error || !profileRes.data) {
      return NextResponse.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    const product = productRes.data;
    const member = profileRes.data;

    if (!product.is_active) {
      return NextResponse.json({ error: '비활성화된 상품입니다.' }, { status: 400 });
    }

    if ((member.coin_balance ?? 0) < product.coin_price) {
      return NextResponse.json({ error: '사용자의 코인이 부족하여 교환할 수 없습니다.' }, { status: 400 });
    }

    const nextBalance = (member.coin_balance ?? 0) - product.coin_price;

    // 2. 코인 차감 업데이트
    const { error: updateError } = await adminSupabase
      .from('club_members')
      .update({
        coin_balance: nextBalance,
      })
      .eq('club_id', clubId)
      .eq('user_id', profileId)
      .eq('status', 'active');

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
        .from('club_members')
        .update({ coin_balance: member.coin_balance ?? 0 })
        .eq('club_id', clubId)
        .eq('user_id', profileId)
        .eq('status', 'active');
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

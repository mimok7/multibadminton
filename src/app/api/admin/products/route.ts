import { NextResponse } from 'next/server';
import { getClubManagerContext } from '@/lib/manager-access';

async function requireAdmin() {
  const context = await getClubManagerContext();
  if ('error' in context) {
    const status = context.error === 'unauthorized' ? 401 : context.error === 'club_not_selected' ? 400 : 403;
    return { error: NextResponse.json({ error: context.error === 'club_not_selected' ? 'Club not selected' : context.error === 'unauthorized' ? 'Unauthorized' : 'Forbidden' }, { status }) };
  }
  return context;
}

export async function GET() {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase } = context;

  // 상품 데이터 조회
  const { data: products, error: productsError } = await adminSupabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  if (productsError) {
    return NextResponse.json({ error: productsError.message }, { status: 500 });
  }

  let purchases: any[] = [];
  let purchasesError = null;

  // Try retrieving with status column
  const firstTry = await adminSupabase
    .from('product_purchases')
    .select(`
      id,
      profile_id,
      product_id,
      coin_price,
      created_at,
      status,
      profiles:profile_id(full_name, username),
      products:product_id(name)
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  if (firstTry.error) {
    const errMsg = firstTry.error.message || '';
    if (errMsg.includes('status') && (errMsg.includes('does not exist') || errMsg.includes('column'))) {
      const secondTry = await adminSupabase
        .from('product_purchases')
        .select(`
          id,
          profile_id,
          product_id,
          coin_price,
          created_at,
          profiles:profile_id(full_name, username),
          products:product_id(name)
        `)
        .order('created_at', { ascending: false })
        .limit(100);
      
      if (secondTry.error) {
        purchasesError = secondTry.error;
      } else {
        purchases = (secondTry.data || []).map((p: any) => ({ ...p, status: 'applied' }));
      }
    } else {
      purchasesError = firstTry.error;
    }
  } else {
    purchases = firstTry.data || [];
  }

  if (purchasesError) {
    return NextResponse.json(
      { error: purchasesError.message || '상품 데이터를 불러오지 못했습니다.' },
      { status: 500 }
    );
  }

  // 조인 데이터 가공 (타입 맞춤)
  const formattedPurchases = purchases.map((p: any) => ({
    id: p.id,
    profile_id: p.profile_id,
    product_id: p.product_id,
    coin_price: p.coin_price,
    created_at: p.created_at,
    status: p.status || 'applied',
    user_name: p.profiles?.full_name || p.profiles?.username || '회원',
    product_name: p.products?.name || '삭제된 상품',
  }));

  return NextResponse.json({
    products: products || [],
    purchases: formattedPurchases,
  });
}

export async function POST(request: Request) {
  const context = await requireAdmin();
  if ('error' in context) return context.error;

  const { adminSupabase } = context;
  const body = await request.json().catch(() => null);
  const action = String(body?.action || '');

  if (action === 'create') {
    const name = String(body?.name || '').trim();
    const coinPrice = Number(body?.coin_price);
    const description = typeof body?.description === 'string' ? body.description.trim() : null;
    const imageSvg = typeof body?.image_svg === 'string' ? body.image_svg.trim() : null;

    if (!name || !Number.isFinite(coinPrice) || coinPrice < 0) {
      return NextResponse.json({ error: '올바른 상품 정보를 입력해주세요.' }, { status: 400 });
    }

    const { data: product, error } = await adminSupabase
      .from('products')
      .insert({
        name,
        coin_price: coinPrice,
        description,
        image_svg: imageSvg,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ product });
  }

  if (action === 'update') {
    const id = String(body?.id || '');
    const name = String(body?.name || '').trim();
    const coinPrice = Number(body?.coin_price);
    const description = typeof body?.description === 'string' ? body.description.trim() : null;
    const imageSvg = typeof body?.image_svg === 'string' ? body.image_svg.trim() : null;
    const isActive = body?.is_active !== false;

    if (!id || !name || !Number.isFinite(coinPrice) || coinPrice < 0) {
      return NextResponse.json({ error: '올바른 상품 정보를 입력해주세요.' }, { status: 400 });
    }

    const { data: product, error } = await adminSupabase
      .from('products')
      .update({
        name,
        coin_price: coinPrice,
        description,
        image_svg: imageSvg,
        is_active: isActive,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ product });
  }

  if (action === 'delete') {
    const id = String(body?.id || '');

    if (!id) {
      return NextResponse.json({ error: '상품 ID가 필요합니다.' }, { status: 400 });
    }

    const { error } = await adminSupabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  if (action === 'update_purchase_status') {
    const purchaseId = String(body?.purchase_id || '');
    const status = String(body?.status || '');

    if (!purchaseId || !status) {
      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    const { data: purchase, error } = await (adminSupabase as any)
      .from('product_purchases')
      .update({ status })
      .eq('id', purchaseId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ purchase });
  }

  if (action === 'delete_old_purchases') {
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const oneMonthAgoStr = oneMonthAgo.toISOString();

    const { error: firstError } = await adminSupabase
      .from('product_purchases')
      .delete()
      .eq('status', 'completed')
      .lt('created_at', oneMonthAgoStr);

    if (firstError) {
      const errMsg = firstError.message || '';
      if (errMsg.includes('status') && (errMsg.includes('does not exist') || errMsg.includes('column'))) {
        const { error: secondError } = await adminSupabase
          .from('product_purchases')
          .delete()
          .lt('created_at', oneMonthAgoStr);
          
        if (secondError) {
          return NextResponse.json({ error: secondError.message }, { status: 500 });
        }
      } else {
        return NextResponse.json({ error: firstError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: '지원하지 않는 액션입니다.' }, { status: 400 });
}

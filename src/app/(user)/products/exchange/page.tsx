'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/useUser';
import { Coins, Gift, RefreshCw, AlertCircle, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { formatKSTDateTime } from '@/lib/date';

type Product = {
  id: string;
  name: string;
  coin_price: number;
  description: string | null;
  image_svg: string | null;
  is_active: boolean;
};

type ProductPurchase = {
  id: string;
  profile_id: string;
  product_id: string;
  coin_price: number;
  created_at: string;
  product_name: string;
};

export default function UserProductsExchangePage() {
  const { profile, loading: userLoading, refreshProfile } = useUser();
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<ProductPurchase[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [dbMissing, setDbMissing] = useState(false);
  const [exchangingId, setExchangingId] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setDbMissing(false);

      const [response, purchasesResponse] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/products/purchases'),
      ]);
      const [payload, purchasesPayload] = await Promise.all([
        response.json().catch(() => null),
        purchasesResponse.json().catch(() => null),
      ]);

      if (!response.ok) {
        const errMsg = payload?.error || '';
        if (errMsg.includes('relation') && errMsg.includes('does not exist')) {
          setDbMissing(true);
        }
        throw new Error(errMsg || '상품 목록 조회 실패');
      }

      setProducts(payload?.products || []);

      if (purchasesResponse.ok) {
        setPurchases(purchasesPayload?.purchases || []);
      }
    } catch (error) {
      console.error('상품 교환 데이터 패치 에러:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleExchange = async (product: Product) => {
    const coinBalance = profile?.coin_balance ?? 0;
    if (coinBalance < product.coin_price) {
      alert(`보유 코인이 부족합니다.\n필요 코인: ${product.coin_price}코인\n보유 코인: ${coinBalance}코인`);
      return;
    }

    if (!await confirm(`🎁 "${product.name}" 상품을 교환하시겠습니까?\n[${product.coin_price} 코인이 차감됩니다]`)) {
      return;
    }

    try {
      setExchangingId(product.id);
      const response = await fetch('/api/products/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: product.id }),
      });

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(payload?.error || '상품 교환 처리 실패');
      }

      alert(`🎉 "${product.name}" 교환이 완료되었습니다!\n현장에서 관리자에게 확인해 주세요.`);
      
      // 프로필 잔액 갱신 및 데이터 리로드
      await refreshProfile();
      await fetchData();
    } catch (error) {
      console.error('상품 교환 처리 에러:', error);
      alert(error instanceof Error ? error.message : '교환 처리 중 오류가 발생했습니다.');
    } finally {
      setExchangingId(null);
    }
  };

  const isPageLoading = userLoading || (loading && products.length === 0 && !dbMissing);

  if (isPageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb]">
        <div className="flex items-center">
          <RefreshCw className="h-6 w-6 animate-spin text-indigo-600" />
          <span className="ml-2 text-slate-700 font-semibold text-sm">상품 정보를 불러오는 중입니다...</span>
        </div>
      </div>
    );
  }

  const userCoins = profile?.coin_balance ?? 0;

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900 pb-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
        {/* 1. 상단 그라디언트 비주얼 헤더 */}
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          <div className="relative z-10 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5 pl-2">
                <h1 className="text-xl font-bold tracking-tight">상품 교환</h1>
              </div>
              <Link
                href="/dashboard"
                className="rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/15"
              >
                홈
              </Link>
            </div>

            {/* 코인 잔액 디스플레이 카드 (Glassmorphism) */}
            <div className="flex items-center justify-between rounded-[18px] bg-white/10 border border-white/10 p-3.5 backdrop-blur-sm">
              <div className="space-y-0.5">
                <span className="text-[11px] text-indigo-200 font-medium">나의 현재 보유 잔액</span>
                <div className="flex items-center gap-1.5">
                  <Coins className="h-5 w-5 text-amber-400" />
                  <span className="text-xl font-black text-amber-300">{userCoins}</span>
                  <span className="text-xs font-semibold text-slate-200">코인</span>
                </div>
              </div>
              <div className="rounded-full bg-white/5 p-2">
                <Gift className="h-6 w-6 text-indigo-300" />
              </div>
            </div>
          </div>
        </section>

        {/* 2. DB 미생성 예외 배너 */}
        {dbMissing && (
          <section className="rounded-[24px] border border-amber-200 bg-amber-50/70 p-4 shadow-sm flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-amber-900">교환 시스템 준비 중</h4>
              <p className="text-xs text-amber-800 leading-relaxed">
                현재 관리자가 데이터베이스 테이블 생성을 진행하고 있습니다. 잠시 후 새로고침해 주세요.
              </p>
            </div>
          </section>
        )}

        {/* 3. 상품 목록 영역 */}
        <section className="rounded-[24px] bg-white px-3 py-3 sm:px-4 sm:py-4 shadow-sm flex flex-col gap-4">
          <div>
            <p className="text-xs text-slate-500">마켓</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-slate-700" />
              교환 가능한 상품 목록
            </h2>
          </div>

          {!dbMissing && products.length === 0 ? (
            <div className="rounded-[20px] bg-slate-50 p-8 text-center text-sm text-slate-500 shadow-sm border border-slate-200/50">
              현재 준비된 교환 상품이 없습니다.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {products.map((product) => {
                const canAfford = userCoins >= product.coin_price;
                const isExchanging = exchangingId === product.id;

                return (
                  <div 
                    key={product.id}
                    className="flex flex-col justify-between rounded-[20px] border border-slate-200 bg-slate-50 p-3 transition hover:bg-slate-100/70 duration-200"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {product.image_svg ? (
                            <div className="h-7 w-7 shrink-0 text-slate-700 bg-white border border-slate-200 rounded-lg p-1 flex items-center justify-center" dangerouslySetInnerHTML={{ __html: product.image_svg }} />
                          ) : (
                            <div className="h-7 w-7 shrink-0 text-slate-400 bg-white border border-slate-200 rounded-lg p-1 flex items-center justify-center">
                              <Gift className="h-3.5 w-3.5" />
                            </div>
                          )}
                          <h3 className="font-semibold text-slate-900 text-sm truncate">{product.name}</h3>
                        </div>
                        <div className="flex items-center gap-0.5 rounded-lg bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 shrink-0">
                          <Coins className="h-3 w-3 text-amber-600" />
                          {product.coin_price}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500 leading-relaxed min-h-[2rem]">
                        {product.description || '상품 정보가 아직 등록되지 않았습니다.'}
                      </p>
                    </div>

                    <div className="mt-2.5">
                      <Button
                        type="button"
                        onClick={() => handleExchange(product)}
                        disabled={isExchanging || !canAfford}
                        className={`w-full h-8 font-semibold text-xs rounded-xl transition ${
                          canAfford 
                            ? 'bg-[#0f172a] hover:bg-slate-800 text-white shadow-sm' 
                            : 'bg-slate-200 hover:bg-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        {isExchanging ? '교환 진행 중...' : canAfford ? '상품 교환 신청' : '코인 부족'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 4. 본인 최근 교환 이력 */}
        <section className="rounded-[24px] bg-white px-3 py-3 sm:px-4 sm:py-4 shadow-sm flex flex-col gap-4">
          <div>
            <p className="text-xs text-slate-500">내역</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">나의 최근 교환 내역</h2>
          </div>
          {purchases.length === 0 ? (
            <div className="rounded-[20px] bg-slate-50 p-8 text-center text-xs text-slate-500 shadow-sm border border-slate-200/50">
              최근에 교환하신 상품 내역이 없습니다.
            </div>
          ) : (
            <div className="rounded-[20px] border border-slate-200/60 bg-slate-50 p-4 divide-y divide-slate-200/60">
              {purchases.map((purchase) => (
                <div key={purchase.id} className="flex items-center justify-between py-3 first:pt-1 last:pb-1">
                  <div>
                    <span className="font-semibold text-slate-800 text-sm">{purchase.product_name}</span>
                    <p className="mt-1 text-[10px] text-slate-400">
                      교환일: {formatKSTDateTime(purchase.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-rose-600 text-sm">-{purchase.coin_price} 코인</span>
                    <p className="mt-0.5 text-[9px] text-emerald-600 font-semibold">교환 완료</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

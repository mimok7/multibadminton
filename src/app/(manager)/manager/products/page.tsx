'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Edit2, AlertCircle, Coins, Gift, RefreshCw, Copy, Check, ToggleLeft, ToggleRight, LayoutGrid, List } from 'lucide-react';

type Product = {
  id: string;
  name: string;
  coin_price: number;
  description: string | null;
  image_svg: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type ProductPurchase = {
  id: string;
  profile_id: string;
  product_id: string;
  coin_price: number;
  created_at: string;
  user_name: string;
  product_name: string;
  status: 'applied' | 'completed';
};

type UserProfile = {
  id: string;
  username: string | null;
  full_name: string | null;
  email: string | null;
  coin_balance: number;
};

const CREATE_PRODUCTS_SQL = `-- 상품 정보 테이블 생성
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    coin_price INTEGER NOT NULL CHECK (coin_price >= 0),
    description TEXT,
    image_svg TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 상품 구매/차감 기록 테이블 생성
CREATE TABLE IF NOT EXISTS public.product_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    coin_price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'applied',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기본 상품 3종 자동 등록 (그립, 양말, 셔틀콕)
INSERT INTO public.products (name, coin_price, description, image_svg)
VALUES 
    ('그립', 5, '배드민턴 라켓용 오버그립', '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="5" y1="6" x2="19" y2="6"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="5" y1="14" x2="19" y2="14"/><line x1="5" y1="18" x2="19" y2="18"/></svg>'),
    ('양말', 10, '스포츠용 두꺼운 배드민턴 양말', '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v9.5a7.5 7.5 0 0 0 15 0V3H6z"/></svg>'),
    ('셔틀콕', 15, '경기용 고급 셔틀콕 1개', '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M12 15L8 3l4 3 4-3-4 12Z"/></svg>')
ON CONFLICT DO NOTHING;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_svg TEXT;
ALTER TABLE public.product_purchases ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'applied';

UPDATE public.products SET image_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="5" y1="6" x2="19" y2="6"/><line x1="5" y1="10" x2="19" y2="10"/><line x1="5" y1="14" x2="19" y2="14"/><line x1="5" y1="18" x2="19" y2="18"/></svg>' WHERE name = '그립' AND image_svg IS NULL;
UPDATE public.products SET image_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v9.5a7.5 7.5 0 0 0 15 0V3H6z"/></svg>' WHERE name = '양말' AND image_svg IS NULL;
UPDATE public.products SET image_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M12 15L8 3l4 3 4-3-4 12Z"/></svg>' WHERE name = '셔틀콕' AND image_svg IS NULL;

-- RLS 활성화 및 접근 권한 설정
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_purchases ENABLE ROW LEVEL SECURITY;

-- 상품 조회는 누구나 가능
DROP POLICY IF EXISTS "Anyone can view active products" ON public.products;
CREATE POLICY "Anyone can view active products" ON public.products
    FOR SELECT USING (true);

-- 상품 생성/수정/삭제는 관리자만 가능
DROP POLICY IF EXISTS "Admins can manage products" ON public.products;
CREATE POLICY "Admins can manage products" ON public.products
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE (p.user_id = auth.uid() OR p.id = auth.uid())
              AND p.role = 'admin'
        )
    );

-- 본인의 상품 구매 이력은 본인만 조회 가능
DROP POLICY IF EXISTS "Users can view own purchases" ON public.product_purchases;
CREATE POLICY "Users can view own purchases" ON public.product_purchases
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = product_purchases.profile_id
              AND (p.user_id = auth.uid() OR p.id = auth.uid())
        )
    );

-- 관리자는 모든 구매 이력 조회 가능
DROP POLICY IF EXISTS "Admins can view all purchases" ON public.product_purchases;
CREATE POLICY "Admins can view all purchases" ON public.product_purchases
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE (p.user_id = auth.uid() OR p.id = auth.uid())
              AND p.role = 'admin'
        )
    );

-- 구매 기록 생성은 본인 또는 관리자만 가능
DROP POLICY IF EXISTS "Users can record purchases" ON public.product_purchases;
CREATE POLICY "Users can record purchases" ON public.product_purchases
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = product_purchases.profile_id
              AND (p.user_id = auth.uid() OR p.id = auth.uid())
        )
        OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE (p.user_id = auth.uid() OR p.id = auth.uid())
              AND p.role = 'admin'
        )
    );`;

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [purchases, setPurchases] = useState<ProductPurchase[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [dbMissing, setDbMissing] = useState(false);
  const [copied, setCopied] = useState(false);

  // 상품 추가/수정용 상태
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('0');
  const [formDescription, setFormDescription] = useState('');
  const [formImageSvg, setFormImageSvg] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 상품 지급용 상태
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [allocating, setAllocating] = useState(false);

  // 최근 상품 지급 및 차감 내역 필터링, 보기 및 삭제용 상태
  const [purchaseFilter, setPurchaseFilter] = useState<'all' | 'applied'>('applied');
  const [purchaseViewType, setPurchaseViewType] = useState<'list' | 'card'>('card');
  const [deletingOld, setDeletingOld] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      setDbMissing(false);

      // 1. 상품 및 구매 이력 가져오기
      const response = await fetch('/api/admin/products', { credentials: 'include' });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const errMsg = payload?.error || '';
        if (errMsg.includes('relation') && errMsg.includes('does not exist')) {
          setDbMissing(true);
        }
        throw new Error(errMsg || '상품 데이터 조회 실패');
      }

      setProducts(payload?.products || []);
      setPurchases(payload?.purchases || []);

      // 2. 지급 대상을 위한 사용자 목록 가져오기
      const userResponse = await fetch('/api/admin/coins', { credentials: 'include' });
      const userPayload = await userResponse.json().catch(() => null);

      if (userResponse.ok) {
        setUsers(userPayload?.profiles || []);
      }
    } catch (error) {
      console.error('상품 관리 데이터 로딩 에러:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCopySql = () => {
    navigator.clipboard.writeText(CREATE_PRODUCTS_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenCreate = () => {
    setIsEditing(true);
    setEditingId(null);
    setFormName('');
    setFormPrice('0');
    setFormDescription('');
    setFormImageSvg('');
    setFormActive(true);
  };

  const handleOpenEdit = (product: Product) => {
    setIsEditing(true);
    setEditingId(product.id);
    setFormName(product.name);
    setFormPrice(String(product.coin_price));
    setFormDescription(product.description || '');
    setFormImageSvg(product.image_svg || '');
    setFormActive(product.is_active);
  };

  const handleCloseForm = () => {
    setIsEditing(false);
    setEditingId(null);
  };

  const handleSaveProduct = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = formName.trim();
    const price = Number(formPrice);

    if (!name || isNaN(price) || price < 0) {
      alert('올바른 상품 이름과 0 이상의 가격을 입력해주세요.');
      return;
    }

    try {
      setSubmitting(true);
      const action = editingId ? 'update' : 'create';
      const body = {
        action,
        id: editingId,
        name,
        coin_price: price,
        description: formDescription.trim() || null,
        image_svg: formImageSvg.trim() || null,
        is_active: formActive,
      };

      const response = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '상품 저장 실패');
      }

      alert(editingId ? '상품이 수정되었습니다.' : '상품이 등록되었습니다.');
      setIsEditing(false);
      await fetchData();
    } catch (error) {
      console.error('상품 저장 오류:', error);
      alert(error instanceof Error ? error.message : '상품 처리 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    if (!confirm(`정말로 상품 "${name}"을(를) 삭제하시겠습니까?`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id }),
        credentials: 'include',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '상품 삭제 실패');
      }

      alert('상품이 삭제되었습니다.');
      await fetchData();
    } catch (error) {
      console.error('상품 삭제 오류:', error);
      alert(error instanceof Error ? error.message : '상품 삭제 중 오류가 발생했습니다.');
      setLoading(false);
    }
  };

  const handleAllocateProduct = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedUserId || !selectedProductId) {
      alert('지급할 회원과 상품을 모두 선택해 주세요.');
      return;
    }

    const targetUser = users.find(u => u.id === selectedUserId);
    const targetProduct = products.find(p => p.id === selectedProductId);

    if (!targetUser || !targetProduct) {
      alert('선택한 회원이나 상품 정보가 존재하지 않습니다.');
      return;
    }

    if (targetUser.coin_balance < targetProduct.coin_price) {
      alert(`회원의 보유 코인(${targetUser.coin_balance}개)이 상품 가격(${targetProduct.coin_price}코인)보다 부족하여 지급할 수 없습니다.`);
      return;
    }

    if (!confirm(`"${targetUser.full_name || targetUser.username || '회원'}" 회원에게 "${targetProduct.name}"을(를) 지급하고 ${targetProduct.coin_price}코인을 차감하시겠습니까?`)) {
      return;
    }

    try {
      setAllocating(true);
      const response = await fetch('/api/admin/products/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: selectedUserId,
          product_id: selectedProductId,
        }),
        credentials: 'include',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '상품 지급 및 차감 처리 실패');
      }

      alert('상품 지급 및 코인 차감 처리가 성공적으로 완료되었습니다.');
      setSelectedUserId('');
      setSelectedProductId('');
      await fetchData();
    } catch (error) {
      console.error('상품 지급 오류:', error);
      alert(error instanceof Error ? error.message : '상품 지급 중 오류가 발생했습니다.');
    } finally {
      setAllocating(false);
    }
  };

  const handleUpdatePurchaseStatus = async (purchaseId: string, newStatus: 'applied' | 'completed') => {
    try {
      const response = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_purchase_status',
          purchase_id: purchaseId,
          status: newStatus
        }),
        credentials: 'include',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '상태 변경 실패');
      }

      await fetchData();
    } catch (error) {
      console.error('구매 상태 업데이트 오류:', error);
      alert(error instanceof Error ? error.message : '상태 처리 중 오류가 발생했습니다.');
    }
  };

  const handleDeleteOldPurchases = async () => {
    if (!confirm('지급 완료된 지 1달이 지난 최근 상품 지급 및 차감 내역을 영구적으로 삭제하시겠습니까?')) {
      return;
    }

    try {
      setDeletingOld(true);
      const response = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_old_purchases' }),
        credentials: 'include',
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '오래된 데이터 삭제 실패');
      }

      alert('지급 완료된 지 1달이 지난 내역이 삭제되었습니다.');
      await fetchData();
    } catch (error) {
      console.error('오래된 데이터 삭제 오류:', error);
      alert(error instanceof Error ? error.message : '오래된 데이터 삭제 중 오류가 발생했습니다.');
    } finally {
      setDeletingOld(false);
    }
  };

  const filteredPurchases = purchases.filter((p) => {
    if (purchaseFilter === 'applied') {
      return p.status === 'applied';
    }
    return true;
  });

  if (loading && products.length === 0 && !dbMissing) {
    return (
      <div className="flex h-64 items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-indigo-600" />
        <span className="ml-2 text-slate-600 font-medium">상품 데이터를 불러오는 중입니다...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. DB 테이블 없음 예외 처리 가이드 */}
      {dbMissing && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-6 w-6 shrink-0 text-amber-600" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-amber-900">데이터베이스 테이블 미생성 안내</h3>
              <p className="text-sm leading-relaxed text-amber-800">
                상품 데이터를 관리하기 위해 필요한 테이블(<code>products</code> 및 <code>product_purchases</code>)이 데이터베이스에 존재하지 않습니다.<br />
                아래 SQL 스크립트를 복사하여 <strong>Supabase Dashboard → SQL Editor</strong>에 붙여넣고 실행(Run)해 주세요.
              </p>
              
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-100/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-amber-900 uppercase">SQL 스크립트 (create_products.sql)</span>
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={handleCopySql}
                    className="h-8 border-amber-300 bg-white text-amber-800 hover:bg-amber-100"
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                        복사 완료
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        스크립트 복사
                      </>
                    )}
                  </Button>
                </div>
                <pre className="max-h-60 overflow-y-auto rounded-lg bg-slate-900 p-3 text-left text-xs font-mono text-slate-200 leading-5">
                  {CREATE_PRODUCTS_SQL}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 상단 헤더 */}
      <div className="hidden md:flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Gift className="h-7 w-7 text-indigo-600" />
            상품 관리
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            사용자들이 획득한 코인으로 교환할 수 있는 물품(그립, 양말, 셔틀콕 등)을 등록하고 관리합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchData} disabled={loading} className="h-10">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </Button>
          <Button onClick={handleOpenCreate} disabled={loading || dbMissing} className="h-10 bg-indigo-600 hover:bg-indigo-700">
            <Plus className="mr-2 h-4 w-4" />
            새 상품 등록
          </Button>
        </div>
      </div>

      {/* 3. 상품 등록 및 수정 모달/폼 (인라인 박스 형태로 배치) */}
      {isEditing && (
        <div className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900 mb-4">
            {editingId ? '🎁 상품 정보 수정' : '🎁 새 상품 등록'}
          </h2>
          <form onSubmit={handleSaveProduct} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5 block">
                <span className="text-sm font-semibold text-slate-700">상품 이름 <span className="text-red-500">*</span></span>
                <input
                  type="text"
                  required
                  placeholder="예: 그립, 셔틀콕"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500outline-none"
                />
              </label>

              <label className="space-y-1.5 block">
                <span className="text-sm font-semibold text-slate-700">코인 가격 <span className="text-red-500">*</span></span>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    required
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                  />
                  <Coins className="absolute left-2.5 top-3 h-4 w-4 text-amber-500" />
                </div>
              </label>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-sm font-semibold text-slate-700">상품 설명</span>
              <textarea
                placeholder="상품에 대한 세부 설명을 입력해 주세요."
                rows={2}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </label>

            <label className="space-y-1.5 block">
              <span className="text-sm font-semibold text-slate-700">SVG 아이콘 (선택사항)</span>
              <textarea
                placeholder="<svg>...</svg> 형태의 코드를 입력해 주세요."
                rows={2}
                value={formImageSvg}
                onChange={(e) => setFormImageSvg(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              />
            </label>

            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">활성화 상태:</span>
              <button
                type="button"
                onClick={() => setFormActive(!formActive)}
                className="focus:outline-none"
              >
                {formActive ? (
                  <ToggleRight className="h-9 w-9 text-emerald-600" />
                ) : (
                  <ToggleLeft className="h-9 w-9 text-slate-400" />
                )}
              </button>
              <span className="text-xs text-slate-500">
                {formActive ? '사용자가 직접 코인으로 교환할 수 있습니다.' : '사용자 화면에 노출되지 않습니다.'}
              </span>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleCloseForm} disabled={submitting}>
                취소
              </Button>
              <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700">
                {submitting ? '저장 중...' : '상품 저장'}
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="hidden md:grid gap-6 lg:grid-cols-3">
        {/* 4. 상품 리스트 및 관리 */}
        <div className="rounded-2xl bg-white p-6 shadow-sm lg:col-span-2 space-y-4">
          <h2 className="text-lg font-bold text-slate-900">등록된 상품 리스트</h2>
          {products.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center text-slate-500">
              {dbMissing ? '데이터베이스 테이블을 먼저 생성해 주세요.' : '등록된 상품이 없습니다. 새 상품을 등록해 보세요!'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-500 font-semibold">
                    <th className="pb-3 pr-4">상품 정보</th>
                    <th className="pb-3 pr-4 text-center">가격</th>
                    <th className="pb-3 pr-4 text-center">상태</th>
                    <th className="pb-3 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {products.map((product) => (
                    <tr key={product.id} className="hover:bg-slate-50/50">
                      <td className="py-3.5 pr-4">
                        <div className="flex items-center gap-3">
                          {product.image_svg ? (
                            <div className="h-10 w-10 shrink-0 text-indigo-600 bg-indigo-50 rounded-lg p-2 flex items-center justify-center" dangerouslySetInnerHTML={{ __html: product.image_svg }} />
                          ) : (
                            <div className="h-10 w-10 shrink-0 text-slate-400 bg-slate-100 rounded-lg p-2 flex items-center justify-center">
                              <Gift className="h-6 w-6" />
                            </div>
                          )}
                          <div>
                            <div className="font-semibold text-slate-900">{product.name}</div>
                            {product.description && (
                              <div className="mt-1 text-xs text-slate-500 max-w-xs truncate">{product.description}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 pr-4 text-center">
                        <div className="inline-flex items-center gap-1 font-bold text-amber-600">
                          <Coins className="h-4 w-4" />
                          {product.coin_price}
                        </div>
                      </td>
                      <td className="py-3.5 pr-4 text-center">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          product.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {product.is_active ? '활성' : '비활성'}
                        </span>
                      </td>
                      <td className="py-3.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleOpenEdit(product)} 
                            className="h-8 px-2 text-slate-600 hover:text-slate-900"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => handleDeleteProduct(product.id, product.name)} 
                            className="h-8 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 5. 사용자 직접 지급 (코인 강제 차감) 폼 */}
        <div className="rounded-2xl bg-white p-6 shadow-sm h-fit space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900">현장 상품 지급</h2>
            <p className="text-xs text-slate-500">
              관리자가 수동으로 회원에게 상품을 즉각 지급하고, 코인을 잔액에서 강제 차감합니다.
            </p>
          </div>
          
          <form onSubmit={handleAllocateProduct} className="space-y-4 pt-2">
            <label className="space-y-1.5 block">
              <span className="text-sm font-semibold text-slate-700">지급 대상 회원</span>
              <select
                required
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              >
                <option value="">회원을 선택해 주세요</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.username || '회원'} (보유: {u.coin_balance ?? 0}코인)
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5 block">
              <span className="text-sm font-semibold text-slate-700">지급할 상품</span>
              <select
                required
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
              >
                <option value="">상품을 선택해 주세요</option>
                {products.filter(p => p.is_active).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.coin_price}코인)
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="submit"
              disabled={allocating || dbMissing || products.length === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700 h-10 font-semibold"
            >
              {allocating ? '지급 처리 중...' : '지급 및 코인 차감'}
            </Button>
          </form>
        </div>
      </div>

      {/* 6. 전체 사용자 최근 상품 교환/지급 이력 */}
      <div className="rounded-2xl bg-white p-6 shadow-sm space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              최근 상품 지급 및 차감 내역
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              회원들의 상품 교환 신청 및 지급 내역을 조회하고 지급 처리를 할 수 있습니다.
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* 필터링 버튼 */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setPurchaseFilter('all')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all duration-200 ${
                  purchaseFilter === 'all'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                전체 ({purchases.length})
              </button>
              <button
                type="button"
                onClick={() => setPurchaseFilter('applied')}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-all duration-200 ${
                  purchaseFilter === 'applied'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                신청완료 ({purchases.filter(p => p.status === 'applied').length})
              </button>
            </div>

            {/* 보기 방식 토글 */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setPurchaseViewType('list')}
                className={`rounded-md p-1 transition-all duration-200 ${
                  purchaseViewType === 'list'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
                title="리스트 보기"
              >
                <List className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPurchaseViewType('card')}
                className={`rounded-md p-1 transition-all duration-200 ${
                  purchaseViewType === 'card'
                    ? 'bg-white text-indigo-600 shadow-xs'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
                title="카드 보기 (7열)"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>

            {/* 1달 경과 데이터 삭제 버튼 */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDeleteOldPurchases}
              disabled={deletingOld}
              className="hidden md:inline-flex h-8 border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 hover:border-rose-300 font-semibold"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              1달 경과 내역 삭제
            </Button>
          </div>
        </div>

        {filteredPurchases.length === 0 ? (
          <div className="rounded-xl bg-slate-50 py-12 text-center text-sm text-slate-500 border border-slate-100">
            {purchaseFilter === 'applied' ? '신청 완료 상태인 내역이 없습니다.' : '상품 지급 또는 교환 이력이 아직 없습니다.'}
          </div>
        ) : purchaseViewType === 'list' ? (
          <div className="space-y-3">
            {filteredPurchases.map((purchase) => (
              <div key={purchase.id} className="rounded-xl border border-slate-100 bg-slate-50/30 px-4 py-3 hover:bg-slate-50/70 transition-all duration-200">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-semibold text-slate-900">{purchase.user_name}</span>
                    <span className="text-slate-500 text-xs"> 회원에게</span>
                    <span className="ml-1.5 font-bold text-indigo-700">{purchase.product_name}</span>
                    <span className={`ml-1.5 text-xs font-semibold rounded-full px-2 py-0.5 ${
                      purchase.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {purchase.status === 'completed' ? '지급 완료' : '신청완료'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 sm:text-right">
                    {purchase.status !== 'completed' && (
                      <Button
                        size="sm"
                        onClick={() => handleUpdatePurchaseStatus(purchase.id, 'completed')}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs font-semibold px-2.5 rounded-lg shrink-0"
                      >
                        지급완료
                      </Button>
                    )}
                    <span className="inline-flex items-center gap-0.5 font-bold text-rose-600 text-sm">
                      -{purchase.coin_price}코인
                    </span>
                    <span className="text-xs text-slate-400">
                      {new Date(purchase.created_at).toLocaleString('ko-KR')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
            {filteredPurchases.map((purchase) => {
              const isApplied = purchase.status !== 'completed';
              return (
                <div 
                  key={purchase.id} 
                  className={`rounded-xl border p-4 flex flex-col justify-between transition-all duration-200 hover:shadow-md ${
                    isApplied 
                      ? 'border-indigo-100 bg-indigo-50/10 hover:bg-indigo-50/20' 
                      : 'border-slate-100 bg-white hover:border-slate-200'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isApplied 
                          ? 'bg-amber-50 text-amber-700 border border-amber-200' 
                          : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      }`}>
                        {isApplied ? '신청완료' : '지급완료'}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400">
                        {new Date(purchase.created_at).toLocaleDateString('ko-KR')}
                      </span>
                    </div>

                    <div>
                      <h4 className="font-bold text-slate-900 text-sm leading-snug truncate" title={purchase.user_name}>
                        {purchase.user_name}
                      </h4>
                      <p className="text-xs text-slate-500 truncate mt-0.5" title={purchase.product_name}>
                        {purchase.product_name}
                      </p>
                    </div>

                    <div className="inline-flex items-center gap-1 font-bold text-rose-600 text-xs">
                      <Coins className="h-3 w-3" />
                      -{purchase.coin_price}코인
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-slate-100/80 flex flex-col justify-center">
                    {isApplied ? (
                      <Button
                        size="sm"
                        onClick={() => handleUpdatePurchaseStatus(purchase.id, 'completed')}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs font-semibold px-2 rounded-lg"
                      >
                        지급완료
                      </Button>
                    ) : (
                      <span className="text-2xs font-medium text-slate-400 text-center w-full py-1">
                        지급완료됨
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

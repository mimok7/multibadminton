-- Product catalogue: active products for the current club, newest first.
CREATE INDEX IF NOT EXISTS idx_products_club_active_created
  ON public.products (club_id, created_at DESC)
  WHERE is_active = true;

-- Admin purchase history: current club, newest first.
CREATE INDEX IF NOT EXISTS idx_product_purchases_club_created
  ON public.product_purchases (club_id, created_at DESC);

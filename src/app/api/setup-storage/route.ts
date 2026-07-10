import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { isUserAdmin } from '@/lib/auth';

async function requireAdmin() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return Boolean(user && await isUserAdmin(supabase, user));
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: buckets, error } = await adminClient.storage.listBuckets();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ buckets });
}

export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const { data: buckets, error: listError } = await adminClient.storage.listBuckets();
    if (listError) {
      return NextResponse.json({ error: `버킷 목록 조회 실패: ${listError.message}` }, { status: 500 });
    }

    const avatarsBucket = buckets?.find((b) => b.name === 'avatars');

    if (!avatarsBucket) {
      const { error: createError } = await adminClient.storage.createBucket('avatars', {
        public: true,
        fileSizeLimit: 5242880,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      });

      if (createError) {
        return NextResponse.json({ error: `버킷 생성 실패: ${createError.message}` }, { status: 500 });
      }

      return NextResponse.json({ 
        success: true, 
        message: 'avatars 버킷이 새로 생성되었습니다.',
        created: true 
      });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'avatars 버킷이 이미 존재합니다.',
      created: false,
      bucket: avatarsBucket 
    });

  } catch (err: any) {
    return NextResponse.json({ error: err.message || '알 수 없는 오류' }, { status: 500 });
  }
}

// Supabase PostgREST + service_role으로 직접 Storage RLS 정책 설정
export async function PATCH() {
  if (process.env.NODE_ENV === 'production' || !(await requireAdmin())) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Missing environment variables' }, { status: 500 });
  }

  // Supabase의 /rest/v1/rpc/ 엔드포인트를 통해 pg_query 실행
  // service_role 키는 RLS를 우회하고 모든 권한으로 실행
  const sqlList = [
    // 기존 정책 삭제
    `DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects`,
    `DROP POLICY IF EXISTS "avatars_auth_insert" ON storage.objects`,
    `DROP POLICY IF EXISTS "avatars_auth_update" ON storage.objects`,
    `DROP POLICY IF EXISTS "avatars_auth_delete" ON storage.objects`,
    // 새 정책 생성
    `CREATE POLICY "avatars_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'avatars')`,
    `CREATE POLICY "avatars_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)`,
    `CREATE POLICY "avatars_auth_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'avatars' AND owner_id = (SELECT auth.uid()::text)) WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)`,
    `CREATE POLICY "avatars_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'avatars' AND owner_id = (SELECT auth.uid()::text))`,
  ];

  const results: any[] = [];
  
  for (const sql of sqlList) {
    // Supabase의 pg_query RPC 시도
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/pg_query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ query: sql }),
    });
    
    const text = await res.text();
    results.push({ 
      sql: sql.substring(0, 60) + '...', 
      status: res.status, 
      response: text.substring(0, 200) 
    });
  }

  return NextResponse.json({ success: true, results });
}

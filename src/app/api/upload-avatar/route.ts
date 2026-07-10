import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getProfileByUserId } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: '환경 변수가 설정되지 않았습니다.' }, { status: 500 });
  }

  const serverSupabase = await getSupabaseServerClient();
  const { data: { user }, error: authError } = await serverSupabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // service_role 권한으로 Supabase 관리자 클라이언트 생성
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // multipart/form-data에서 파일과 사용자 ID 추출
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 });
    }

    // 파일 크기 검증 (5MB 제한)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: '파일 크기는 5MB를 초과할 수 없습니다.' }, { status: 400 });
    }

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return NextResponse.json({ error: '지원하지 않는 이미지 형식입니다.' }, { status: 400 });
    }

    const profile = await getProfileByUserId(adminClient, user.id);
    if (!profile) {
      return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
    }

    // 고유 파일명 생성
    const fileName = `${user.id}/avatar_${Date.now()}.jpg`;

    // 파일을 ArrayBuffer로 변환
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // service_role 권한으로 업로드 (RLS 정책 우회)
    const { error: uploadError } = await adminClient.storage
      .from('avatars')
      .upload(fileName, buffer, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: `업로드 실패: ${uploadError.message}` }, { status: 500 });
    }

    // Public URL 획득
    const { data: { publicUrl } } = adminClient.storage
      .from('avatars')
      .getPublicUrl(fileName);

    const { error: profileUpdateError } = await adminClient
      .from('profiles')
      .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', profile.id);

    if (profileUpdateError) {
      await adminClient.storage.from('avatars').remove([fileName]);
      return NextResponse.json({ error: `프로필 갱신 실패: ${profileUpdateError.message}` }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      publicUrl,
      fileName 
    });

  } catch (err: any) {
    console.error('Avatar upload server error:', err);
    return NextResponse.json({ error: err.message || '알 수 없는 오류가 발생했습니다.' }, { status: 500 });
  }
}

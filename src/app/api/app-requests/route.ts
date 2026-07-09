import { NextResponse } from 'next/server';
import { getProfileByUserId, getUserRole } from '@/lib/auth';
import { getUnfilteredGlobalAdminClient, getSupabaseServerClient } from '@/lib/supabase-server';

export async function GET() {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = getUnfilteredGlobalAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);
  if (!currentProfile) {
    return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
  }

  const userRole = await getUserRole(serverSupabase, user);
  const isAdmin = ['admin', 'manager'].includes(userRole || '');

  try {
    let query = adminSupabase
      .from('app_modification_requests' as any)
      .select('*, requester:profiles!requester_id(full_name, username)');

    if (!isAdmin) {
      query = query.eq('requester_id', currentProfile.id);
    }

    const { data: requests, error: fetchError } = await query.order('created_at', { ascending: false });

    if (fetchError) {
      throw new Error(fetchError.message);
    }

    return NextResponse.json({ requests });
  } catch (error) {
    console.error('Fetch app requests error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '요청 데이터를 불러오지 못했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = getUnfilteredGlobalAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const currentProfile = await getProfileByUserId(serverSupabase, user.id);
  if (!currentProfile) {
    return NextResponse.json({ error: '프로필을 찾을 수 없습니다.' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const category = String(body?.category || '').trim();
  const menuName = String(body?.menu_name || '').trim();
  const content = String(body?.content || '').trim();

  if (!category || !content) {
    return NextResponse.json({ error: '분류와 내용을 모두 입력해주세요.' }, { status: 400 });
  }

  try {
    const { data: newRequest, error: insertError } = await adminSupabase
      .from('app_modification_requests' as any)
      .insert({
        requester_id: currentProfile.id,
        category,
        menu_name: menuName || null,
        content,
        status: 'pending',
      })
      .select('*')
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    // Find admin profile for 김진호 (name is '김진호' or username is 'kjh')
    const { data: targetAdmins } = await adminSupabase
      .from('profiles')
      .select('id')
      .or('full_name.eq.김진호,username.eq.kjh');

    if (targetAdmins && targetAdmins.length > 0) {
      const requesterName = currentProfile.full_name || currentProfile.username || '회원';
      const notificationInserts = targetAdmins.map((adm) => ({
        user_id: adm.id,
        title: '새 앱 수정 요청',
        message: `${requesterName}님이 [${category}] 수정 요청을 보냈습니다. 대상 메뉴: ${menuName || '없음'}`,
        type: 'general',
        is_read: false,
      }));

      await adminSupabase.from('notifications').insert(notificationInserts);
    }

    return NextResponse.json({ request: newRequest });
  } catch (error) {
    console.error('Create app request error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '요청 저장에 실패했습니다.' },
      { status: 500 }
    );
  }
}

// PUT is for admins to update status/completed_at
export async function PUT(request: Request) {
  const serverSupabase = await getSupabaseServerClient();
  const adminSupabase = getUnfilteredGlobalAdminClient();

  const {
    data: { user },
    error: authError,
  } = await serverSupabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userRole = await getUserRole(serverSupabase, user);
  const isAdmin = ['admin', 'manager'].includes(userRole || '');

  if (!isAdmin) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const requestId = String(body?.request_id || '').trim();
  const nextStatus = String(body?.status || '').trim();
  const notificationMessage = String(body?.notification_message || '').trim();

  if (!requestId || !['pending', 'in_progress', 'completed', 'rejected'].includes(nextStatus)) {
    return NextResponse.json({ error: '잘못된 요청 값입니다.' }, { status: 400 });
  }

  try {
    const updateData: Record<string, any> = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === 'completed') {
      updateData.completed_at = new Date().toISOString();
    } else {
      updateData.completed_at = null;
    }

    const { data: updatedRequest, error: updateError } = (await adminSupabase
      .from('app_modification_requests' as any)
      .update(updateData)
      .eq('id', requestId)
      .select('*')
      .single()) as any;

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (updatedRequest) {
      const statusLabels: Record<string, string> = {
        pending: '대기 중',
        in_progress: '진행 중',
        completed: '완료',
        rejected: '반려',
      };

      const statusLabel = statusLabels[nextStatus] || nextStatus;
      const title = `[앱 수정 요청] ${statusLabel} 안내`;
      
      const defaultMessage = `보내신 앱 수정 요청이 [${statusLabel}] 상태로 변경되었습니다. (분류: ${updatedRequest.category})`;
      const finalMessage = notificationMessage || defaultMessage;

      // Send notification to requester
      await adminSupabase.from('notifications').insert({
        user_id: updatedRequest.requester_id,
        title,
        message: finalMessage,
        type: 'general',
        is_read: false,
      });
    }

    return NextResponse.json({ request: updatedRequest });
  } catch (error) {
    console.error('Update app request error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '상태 변경에 실패했습니다.' },
      { status: 500 }
    );
  }
}

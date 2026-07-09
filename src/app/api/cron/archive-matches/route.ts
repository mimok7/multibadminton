import { NextResponse } from 'next/server';
import { getUnfilteredGlobalAdminClient } from '@/lib/supabase-server';

export async function GET(request: Request) {
  try {
    // 보안: 토큰 확인
    const authHeader = request.headers.get('authorization');
    const secretToken = process.env.CRON_SECRET_TOKEN;

    if (!secretToken || authHeader !== `Bearer ${secretToken}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = getUnfilteredGlobalAdminClient();

    // archive_expired_brackets RPC 호출
    const { error } = await (supabase as any).rpc('archive_expired_brackets');

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: '과거 대진표 정리가 성공적으로 완료되었습니다.',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('API 실행 중 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

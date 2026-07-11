'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getKoreaDate } from '@/lib/date';

export default function DatabaseTestPage() {
  const [testResults, setTestResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    async function testDatabaseConnection() {
      const results: any[] = [];

      try {
        // 1. 현재 사용자 및 세션 확인
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const { data: userData, error: userError } = await supabase.auth.getUser();
        
        results.push({
          test: '현재 사용자 정보',
          success: !userError && !sessionError && !!sessionData.session,
          data: userData?.user,
          error: userError?.message || sessionError?.message || (!sessionData.session ? 'Auth session missing!' : null)
        });
        setCurrentUser(userData?.user);

        if (!sessionData.session) {
          console.log('❌ 세션이 없어서 데이터베이스 테스트를 중단합니다.');
          setTestResults(results);
          setLoading(false);
          return;
        }

        // 2. Profiles 테이블 전체 조회
        const { data: allProfiles, error: profilesError } = await supabase
          .from('profiles')
          .select('*')
          .limit(10);
        
        results.push({
          test: 'Profiles 테이블 조회',
          success: !profilesError,
          data: allProfiles,
          error: profilesError?.message
        });

        // 3. Attendances 테이블 조회 (오늘 날짜)
        const today = getKoreaDate();
        const { data: todayAttendances, error: attendanceError } = await supabase
          .from('attendances')
          .select('*')
          .eq('attended_at', today);
        
        results.push({
          test: `오늘(${today}) 출석 데이터 조회`,
          success: !attendanceError,
          data: todayAttendances,
          error: attendanceError?.message
        });

        // 4. 현재 사용자 프로필 조회
        if (userData?.user?.id) {
          const { data: myProfile, error: myProfileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userData.user.id)
            .single();
          
          results.push({
            test: '내 프로필 조회',
            success: !myProfileError,
            data: myProfile,
            error: myProfileError?.message
          });
        }

        // 5. Level info 테이블 조회
        const { data: levelInfo, error: levelError } = await supabase
          .from('level_info')
          .select('*');
        
        results.push({
          test: 'Level Info 테이블 조회',
          success: !levelError,
          data: levelInfo,
          error: levelError?.message
        });

      } catch (err) {
        results.push({
          test: '전체 테스트',
          success: false,
          data: null,
          error: String(err)
        });
      }

      setTestResults(results);
      setLoading(false);
    }

    testDatabaseConnection();
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">데이터베이스 연결 테스트</h1>
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">데이터베이스 연결 테스트 결과</h1>
      
      {currentUser && (
        <div className="mb-6 p-4 bg-blue-50 rounded">
          <h2 className="font-semibold text-blue-800">현재 로그인 사용자</h2>
          <p>ID: {currentUser.id}</p>
          <p>Email: {currentUser.email}</p>
        </div>
      )}

      <div className="space-y-4">
        {testResults.map((result, index) => (
          <div key={index} className={`p-4 rounded border-l-4 ${
            result.success ? 'bg-green-50 border-green-500' : 'bg-red-50 border-red-500'
          }`}>
            <h3 className="font-semibold">{result.test}</h3>
            <p className={`text-sm ${result.success ? 'text-green-600' : 'text-red-600'}`}>
              상태: {result.success ? '성공' : '실패'}
            </p>
            
            {result.error && (
              <p className="text-red-600 text-sm mt-1">
                오류: {result.error}
              </p>
            )}
            
            {result.data && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-gray-600">
                  데이터 보기 ({Array.isArray(result.data) ? result.data.length : 1}개)
                </summary>
                <pre className="mt-2 p-2 bg-gray-100 rounded text-xs overflow-auto max-h-40">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

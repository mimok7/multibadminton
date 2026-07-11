'use client';

import { useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { isAdminRole } from '@/lib/auth';

export default function AdminSetupPage() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const supabase = getSupabaseClient();

  const checkCurrentUser = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      
      if (!user) {
        setResult('로그인이 필요합니다.');
        return;
      }

      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id);

      if (error) {
        setResult(`프로필 조회 오류: ${error.message}`);
        return;
      }

      // 프로필이 없으면 생성
      if (!profiles || profiles.length === 0) {
        setResult(`프로필이 존재하지 않습니다. 프로필을 생성합니다...`);
        
        const { data: newProfile, error: createError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            role: 'member',
            skill_level: 'E2'
          })
          .select()
          .single();

        if (createError) {
          setResult(`프로필 생성 오류: ${createError.message}`);
          return;
        }

        setResult(`✅ 새 프로필이 생성되었습니다!
- ID: ${user.id}
- Email: ${user.email}
- 이름: ${newProfile?.full_name || newProfile?.username || '없음'}
- Role: ${newProfile?.role || '설정되지 않음'}
- Skill Level: ${newProfile?.skill_level || 'E2'}
- Admin 권한: 아니오`);
        return;
      }

      const profile = profiles[0];
      setResult(`현재 사용자 정보:
- ID: ${user.id}
- Email: ${user.email}
- 이름: ${profile?.full_name || profile?.username || '없음'}
- Role: ${profile?.role || '설정되지 않음'}
- Skill Level: ${profile?.skill_level || 'E2'}
- Admin 권한: ${isAdminRole(profile?.role) ? '예' : '아니오'}`);

    } catch (error) {
      setResult(`오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const setAdminRole = async () => {
    setLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      
      if (!user) {
        setResult('로그인이 필요합니다.');
        return;
      }

      // 먼저 프로필이 존재하는지 확인
      const { data: profiles, error: selectError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id);

      if (selectError) {
        setResult(`프로필 확인 오류: ${selectError.message}`);
        return;
      }

      // 프로필이 없으면 생성
      if (!profiles || profiles.length === 0) {
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: user.id,
            role: 'superadmin',
            skill_level: 'N'
          });

        if (insertError) {
          setResult(`프로필 생성 및 권한 설정 오류: ${insertError.message}`);
          return;
        }

        setResult(`✅ 프로필이 생성되고 관리자 권한이 설정되었습니다!
새로고침하거나 다시 로그인하면 관리자 권한이 적용됩니다.`);
        return;
      }

      // 프로필이 존재하면 업데이트
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: 'superadmin' })
        .eq('id', user.id);

      if (updateError) {
        setResult(`권한 설정 오류: ${updateError.message}`);
        return;
      }

      setResult(`✅ 관리자 권한이 설정되었습니다!
새로고침하거나 다시 로그인하면 관리자 권한이 적용됩니다.`);

    } catch (error) {
      setResult(`오류: ${error}`);
    } finally {
      setLoading(false);
    }
  };

  const refreshPage = () => {
    window.location.reload();
  };

  return (
    <div className="w-full mt-10 p-6">
      <div className="bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          🛡️ 관리자 권한 설정
        </h1>
        
        <div className="space-y-4">
          <div>
            <p className="text-gray-600 mb-4">
              현재 네비게이션에서 "사용자"로 표시되는 문제를 해결하기 위해
              관리자 권한을 확인하고 설정할 수 있습니다.
            </p>
          </div>

          <div className="flex gap-4">
            <Button onClick={checkCurrentUser} disabled={loading}>
              현재 사용자 정보 확인
            </Button>
            
            <Button 
              onClick={setAdminRole} 
              disabled={loading}
              className="bg-red-600 hover:bg-red-700"
            >
              관리자 권한 설정
            </Button>

            <Button onClick={refreshPage} variant="outline">
              페이지 새로고침
            </Button>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-blue-600">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
              처리 중...
            </div>
          )}

          {result && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <pre className="text-sm whitespace-pre-wrap text-gray-800">
                {result}
              </pre>
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h3 className="font-semibold text-blue-800 mb-2">📋 사용법:</h3>
          <ol className="text-sm text-blue-700 space-y-1">
            <li>1. "현재 사용자 정보 확인" 버튼을 클릭하여 현재 권한 상태를 확인</li>
            <li>2. Role이 'admin'이 아니면 "관리자 권한 설정" 버튼 클릭</li>
            <li>3. "페이지 새로고침" 버튼을 클릭하거나 브라우저 새로고침</li>
            <li>4. 네비게이션에서 "관리자"로 표시되는지 확인</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

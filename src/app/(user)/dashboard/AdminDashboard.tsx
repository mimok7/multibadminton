'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface DashboardStats {
  totalUsers: number;
  todayAttendance: number;
  totalMatches: number;
  upcomingMatches: number;
  activeMembers: number;
}

// 관리자 메뉴 탭 인터페이스
interface AdminMenuCard {
  id: string;
  name: string;
  icon: string;
  path: string;
  description: string;
  category: 'match' | 'member' | 'club' | 'system';
  color: 'blue' | 'green' | 'purple' | 'orange';
  adminOnly: boolean;
}

// 관리자 카드 메뉴 데이터
const ADMIN_MENU_CARDS: AdminMenuCard[] = [
  // 경기 관리 카테고리
  { 
    id: 'match-schedule', 
    name: '경기 일정 관리', 
    icon: '📅', 
    path: '/match-schedule', 
    description: '새 경기 생성 및 기존 경기 일정 관리', 
    category: 'match',
    color: 'blue',
    adminOnly: true
  },
  { 
    id: 'match-creation', 
    name: '경기 생성 & 배정', 
    icon: '🏸', 
    path: '/players', 
    description: '참가자 기반 실시간 경기 배정 및 생성', 
    category: 'match',
    color: 'blue',
    adminOnly: true
  },
  { 
    id: 'match-results', 
    name: '경기 결과 관리', 
    icon: '🏆', 
    path: '/match-results', 
    description: '경기 결과 입력 및 통계 관리', 
    category: 'match',
    color: 'blue',
    adminOnly: true
  },
  { 
    id: 'match-participation', 
    name: '경기 참가 현황', 
    icon: '🎯', 
    path: '/match-registration', 
    description: '경기 참가 신청 현황 확인 및 관리', 
    category: 'match',
    color: 'blue',
    adminOnly: false
  },

  // 회원 관리 카테고리
  { 
    id: 'member-management', 
    name: '회원 관리', 
    icon: '�', 
    path: '/admin/members', 
    description: '회원 정보, 권한, 실력 수준 관리', 
    category: 'member',
    color: 'green',
    adminOnly: true
  },
  { 
    id: 'attendance-management', 
    name: '출석 관리', 
    icon: '✅', 
    path: '/admin/attendance', 
    description: '회원 출석 현황 관리 및 통계 확인', 
    category: 'member',
    color: 'green',
    adminOnly: true
  },
  { 
    id: 'team-management', 
    name: '팀 구성 관리', 
    icon: '👥', 
    path: '/team-management', 
    description: '라켓팀/셔틀팀 배정 및 균형 관리', 
    category: 'member',
    color: 'green',
    adminOnly: true
  },
  { 
    id: 'product-management', 
    name: '상품 관리', 
    icon: '🎁', 
    path: '/admin/products', 
    description: '상품 등록/수정 및 회원 상품 지급 관리', 
    category: 'member',
    color: 'green',
    adminOnly: true
  },

  // 클럽 운영 카테고리
  { 
    id: 'regular-meeting', 
    name: '정기모임 관리', 
    icon: '🔄', 
    path: '/recurring-matches', 
    description: '정기모임 자동 생성 설정 및 관리', 
    category: 'club',
    color: 'purple',
    adminOnly: true
  },
  { 
    id: 'notification-management', 
    name: '공지사항 관리', 
    icon: '�', 
    path: '/admin/notifications', 
    description: '클럽 공지사항 및 알림 관리', 
    category: 'club',
    color: 'purple',
    adminOnly: true
  },
  { 
    id: 'court-management', 
    name: '코트 관리', 
    icon: '�️', 
    path: '/admin/courts', 
    description: '배드민턴 코트 현황 및 예약 관리', 
    category: 'club',
    color: 'purple',
    adminOnly: true
  },

  // 시스템 관리 카테고리
  { 
    id: 'system-settings', 
    name: '시스템 설정', 
    icon: '⚙️', 
    path: '/admin', 
    description: '대시보드 메뉴 및 시스템 전체 설정', 
    category: 'system',
    color: 'orange',
    adminOnly: true
  },
  { 
    id: 'system-test', 
    name: '시스템 테스트', 
    icon: '🔧', 
    path: '/database-test', 
    description: '데이터베이스 연결 및 시스템 기능 테스트', 
    category: 'system',
    color: 'orange',
    adminOnly: true
  }
];

export default function AdminDashboard({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const supabase = getSupabaseClient();
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    todayAttendance: 0,
    totalMatches: 0,
    upcomingMatches: 0,
    activeMembers: 0
  });
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [myAttendanceStatus, setMyAttendanceStatus] = useState<'present' | 'lesson' | 'absent' | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const normalizeAttendanceStatus = (value: string | null | undefined): 'present' | 'lesson' | 'absent' | null => {
    return value === 'present' || value === 'lesson' || value === 'absent' ? value : null;
  };

  // 카테고리별 제목 매핑
  const getCategoryTitle = (category: string) => {
    switch (category) {
      case 'match': return '🏸 경기 관리';
      case 'member': return '🛠️ 관리 도구';
      case 'club': return '🏆 클럽 운영';
      case 'system': return '⚙️ 시스템 관리';
      default: return '기타';
    }
  };

  // 색상별 CSS 클래스 매핑
  const getColorClasses = (color: string) => {
    const colorMap: Record<string, {
      bg: string;
      hover: string;
      border: string;
      text: string;
      badge: string;
      memberBadge: string;
    }> = {
      blue: {
        bg: 'bg-blue-50',
        hover: 'hover:bg-blue-100',
        border: 'border-blue-200 hover:border-blue-300',
        text: 'text-blue-900',
        badge: 'bg-red-100 text-red-800',
        memberBadge: 'bg-blue-100 text-blue-800'
      },
      green: {
        bg: 'bg-green-50',
        hover: 'hover:bg-green-100',
        border: 'border-green-200 hover:border-green-300',
        text: 'text-green-900',
        badge: 'bg-red-100 text-red-800',
        memberBadge: 'bg-green-100 text-green-800'
      },
      purple: {
        bg: 'bg-purple-50',
        hover: 'hover:bg-purple-100',
        border: 'border-purple-200 hover:border-purple-300',
        text: 'text-purple-900',
        badge: 'bg-red-100 text-red-800',
        memberBadge: 'bg-purple-100 text-purple-800'
      },
      orange: {
        bg: 'bg-orange-50',
        hover: 'hover:bg-orange-100',
        border: 'border-orange-200 hover:border-orange-300',
        text: 'text-orange-900',
        badge: 'bg-red-100 text-red-800',
        memberBadge: 'bg-orange-100 text-orange-800'
      }
    };
    return colorMap[color] || colorMap.blue;
  };

  useEffect(() => {
    const fetchAdminData = async () => {
      try {
        setLoading(true);
        const today = new Date().toISOString().slice(0, 10);
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        // 쿠키에서 active_club_id 추출
        const activeClubId = document.cookie
          .split('; ')
          .find(row => row.trim().startsWith('active_club_id='))
          ?.split('=')[1];
        const decodedClubId = activeClubId ? decodeURIComponent(activeClubId) : null;

        let membersQuery = supabase.from('club_members').select('*', { count: 'exact', head: true });
        let att1Query = supabase.from('attendances').select('*', { count: 'exact', head: true }).eq('attended_at', today);
        let ms1Query = supabase.from('match_schedules').select('*', { count: 'exact', head: true });
        let ms2Query = supabase.from('match_schedules').select('*', { count: 'exact', head: true }).gte('match_date', today).eq('status', 'scheduled');
        let att2Query = supabase.from('attendances').select('user_id').gte('attended_at', sevenDaysAgo.toISOString().slice(0, 10));
        let att3Query = supabase.from('attendances').select('status').eq('user_id', userId).eq('attended_at', today);

        if (decodedClubId) {
          membersQuery = membersQuery.eq('club_id', decodedClubId);
          att1Query = att1Query.eq('club_id', decodedClubId);
          ms1Query = ms1Query.eq('club_id', decodedClubId);
          ms2Query = ms2Query.eq('club_id', decodedClubId);
          att2Query = att2Query.eq('club_id', decodedClubId);
          att3Query = att3Query.eq('club_id', decodedClubId);
        }

        // 병렬로 모든 데이터 요청
        const [
          profilesResult,
          totalUsersResult,
          todayAttendanceResult,
          matchCountResult,
          upcomingCountResult,
          activeUsersResult,
          myAttendanceResult
        ] = await Promise.allSettled([
          supabase.from('profiles').select('username, full_name').eq('id', userId),
          membersQuery,
          att1Query,
          ms1Query,
          ms2Query,
          att2Query,
          att3Query
        ]);

        // 프로필 정보
        if (profilesResult.status === 'fulfilled') {
          const profile = profilesResult.value.data?.[0];
          setUsername(profile?.full_name || profile?.username || email.split('@')[0]);
        }

        // 통계 데이터 설정
        const totalUsers = totalUsersResult.status === 'fulfilled' ? (totalUsersResult.value.count || 0) : 0;
        const todayAttendance = todayAttendanceResult.status === 'fulfilled' ? (todayAttendanceResult.value.count || 0) : 0;
        const totalMatches = matchCountResult.status === 'fulfilled' ? (matchCountResult.value.count || 0) : 0;
        const upcomingMatches = upcomingCountResult.status === 'fulfilled' ? (upcomingCountResult.value.count || 0) : 0;
        
        // 활성 사용자 계산
        let activeMembers = 0;
        if (activeUsersResult.status === 'fulfilled') {
          const uniqueActiveUsers = activeUsersResult.value.data ? [...new Set(activeUsersResult.value.data.map(a => a.user_id))] : [];
          activeMembers = uniqueActiveUsers.length;
        }

        setStats({
          totalUsers,
          todayAttendance,
          totalMatches,
          upcomingMatches,
          activeMembers
        });

        // 내 출석 상태
        if (myAttendanceResult.status === 'fulfilled') {
          const myAttendance = myAttendanceResult.value.data?.[0];
          setMyAttendanceStatus(normalizeAttendanceStatus(myAttendance?.status));
        }

      } catch (error) {
        console.error('관리자 대시보드 데이터 조회 오류:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAdminData();
  }, [userId, email, supabase]);

  const updateMyAttendanceStatus = async (status: 'present' | 'lesson' | 'absent') => {
    if (isUpdatingStatus) return;
    
    setIsUpdatingStatus(true);
    
    try {
      setMyAttendanceStatus(status);
      
      const today = new Date().toISOString().slice(0, 10);
      
      const { data: existingAttendanceData } = await supabase
        .from('attendances')
        .select('id')
        .match({ user_id: userId, attended_at: today });
      
      const existingAttendance = existingAttendanceData?.[0];
      
      let error;
      
      if (existingAttendance) {
        const result = await supabase
          .from('attendances')
          .update({ status })
          .match({ user_id: userId, attended_at: today });
        
        error = result.error;
      } else {
        const activeClubId = typeof document !== 'undefined'
          ? document.cookie.match(/(?:^|;\s*)active_club_id=([^;]*)/)?.[2] || document.cookie.match(/(?:^|;\s*)active_club_id=([^;]*)/)?.[1] || ''
          : '';

        const result = await supabase
          .from('attendances')
          .insert({
            user_id: userId,
            attended_at: today,
            status,
            club_id: activeClubId
          });
        
        error = result.error;
      }
      
      if (error) {
        console.error('상태 업데이트 오류:', error.message);
        const { data: rollbackData } = await supabase
          .from('attendances')
          .select('status')
          .eq('user_id', userId)
          .eq('attended_at', today);
        setMyAttendanceStatus(normalizeAttendanceStatus(rollbackData?.[0]?.status));
      } else {
        // 상태 업데이트 성공
      }
    } catch (err) {
      console.error('업데이트 처리 중 오류:', err);
      setMyAttendanceStatus(null);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-lg font-bold text-gray-900">관리자 대시보드 🎯</h1>
          <p className="text-base text-gray-600 mt-1">
            안녕하세요, {username}님! 관리자 권한으로 로그인했습니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="outline" className="mr-2">홈으로</Button>
          </Link>
          <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
            관리자
          </span>
          <Button onClick={handleSignOut} variant="outline">로그아웃</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm">총 회원 수</p>
              <p className="text-3xl font-bold">{stats.totalUsers}</p>
            </div>
            <div className="text-4xl opacity-80">👥</div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm">오늘 출석</p>
              <p className="text-3xl font-bold">{stats.todayAttendance}</p>
            </div>
            <div className="text-4xl opacity-80">✅</div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-purple-500 to-purple-600 text-white p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm">총 경기 수</p>
              <p className="text-3xl font-bold">{stats.totalMatches}</p>
            </div>
            <div className="text-4xl opacity-80">🏆</div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm">예정 경기</p>
              <p className="text-3xl font-bold">{stats.upcomingMatches}</p>
            </div>
            <div className="text-4xl opacity-80">📅</div>
          </div>
        </div>

        <div className="bg-gradient-to-r from-teal-500 to-teal-600 text-white p-6 rounded-lg shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-teal-100 text-sm">활성 회원</p>
              <p className="text-3xl font-bold">{stats.activeMembers}</p>
            </div>
            <div className="text-4xl opacity-80">⚡</div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 p-6 rounded-lg mb-8 border border-blue-200">
        <h3 className="text-lg font-semibold text-blue-800 mb-3">내 출석 상태 (회원으로서)</h3>
        <div className="flex gap-2">
          <button
            className={`px-4 py-2 rounded border transition-colors ${
              myAttendanceStatus === 'present'
                ? 'bg-green-300 text-green-900 border-green-400'
                : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200'
            }`}
            onClick={() => updateMyAttendanceStatus('present')}
            disabled={isUpdatingStatus}
          >
            출석
          </button>
          <button
            className={`px-4 py-2 rounded border transition-colors ${
              myAttendanceStatus === 'lesson'
                ? 'bg-yellow-300 text-yellow-900 border-yellow-400'
                : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200'
            }`}
            onClick={() => updateMyAttendanceStatus('lesson')}
            disabled={isUpdatingStatus}
          >
            레슨
          </button>
          <button
            className={`px-4 py-2 rounded border transition-colors ${
              myAttendanceStatus === 'absent'
                ? 'bg-red-300 text-red-900 border-red-400'
                : 'bg-gray-100 text-gray-800 border-gray-300 hover:bg-gray-200'
            }`}
            onClick={() => updateMyAttendanceStatus('absent')}
            disabled={isUpdatingStatus}
          >
            불참
          </button>
        </div>
        {myAttendanceStatus && (
          <p className="text-sm text-blue-700 mt-2">
            현재 상태: <span className="font-medium bg-blue-200 text-blue-800 px-2 py-1 rounded">
              {myAttendanceStatus === 'present' ? '출석' : 
               myAttendanceStatus === 'lesson' ? '레슨' : '불참'}
            </span>
          </p>
        )}
      </div>

      {/* 관리자 기능 카드 메뉴 */}
      <div className="space-y-8 mb-8">
        {['match', 'member', 'club', 'system'].map((category) => {
          const categoryCards = ADMIN_MENU_CARDS.filter(card => card.category === category);
          if (categoryCards.length === 0) return null;
          
          return (
            <div key={category}>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">{getCategoryTitle(category)}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {categoryCards.map((card) => {
                  const colorClasses = getColorClasses(card.color);
                  return (
                    <Link key={card.id} href={card.path}>
                      <div className={`p-5 rounded-lg border-2 transition-all duration-200 shadow-sm hover:shadow-md cursor-pointer transform hover:scale-105 ${
                        colorClasses.bg
                      } ${colorClasses.hover} ${colorClasses.border}`}>
                        <div className="flex items-start justify-between mb-3">
                          <div className="text-2xl">{card.icon}</div>
                          <div className={`px-2 py-1 rounded text-xs font-medium ${
                            card.adminOnly ? colorClasses.badge : colorClasses.memberBadge
                          }`}>
                            {card.adminOnly ? '관리자 전용' : '회원 기능'}
                          </div>
                        </div>
                        <h4 className={`text-base font-semibold mb-2 ${colorClasses.text}`}>{card.name}</h4>
                        <p className="text-sm text-gray-600 leading-relaxed">{card.description}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 개인 회원 기능 */}
      <div className="mb-8">
        <h3 className="text-xl font-semibold text-gray-900 mb-4">🎯 개인 기능 (회원으로서)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/match-registration">
            <div className="bg-indigo-50 border-2 border-indigo-200 hover:border-indigo-300 p-5 rounded-lg hover:bg-indigo-100 transition-all duration-200 transform hover:scale-105">
              <div className="flex items-start justify-between mb-3">
                <div className="text-2xl">🎯</div>
                <div className="bg-indigo-100 text-indigo-800 px-2 py-1 rounded text-xs font-medium">
                  회원 기능
                </div>
              </div>
              <h4 className="text-base font-semibold text-indigo-900 mb-2">경기 참가 신청</h4>
              <p className="text-sm text-gray-600 leading-relaxed">예정된 경기에 참가 신청하고 현황을 확인하세요</p>
            </div>
          </Link>
          
          <Link href="/match-results">
            <div className="bg-teal-50 border-2 border-teal-200 hover:border-teal-300 p-5 rounded-lg hover:bg-teal-100 transition-all duration-200 transform hover:scale-105">
              <div className="flex items-start justify-between mb-3">
                <div className="text-2xl">📊</div>
                <div className="bg-teal-100 text-teal-800 px-2 py-1 rounded text-xs font-medium">
                  회원 기능
                </div>
              </div>
              <h4 className="text-base font-semibold text-teal-900 mb-2">경기 배정 현황</h4>
              <p className="text-sm text-gray-600 leading-relaxed">배정된 경기 현황과 일정을 확인하세요</p>
            </div>
          </Link>
          
          <Link href="/my-schedule">
            <div className="bg-emerald-50 border-2 border-emerald-200 hover:border-emerald-300 p-5 rounded-lg hover:bg-emerald-100 transition-all duration-200 transform hover:scale-105">
              <div className="flex items-start justify-between mb-3">
                <div className="text-2xl">📋</div>
                <div className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-medium">
                  회원 기능
                </div>
              </div>
              <h4 className="text-base font-semibold text-emerald-900 mb-2">나의 경기 일정</h4>
              <p className="text-sm text-gray-600 leading-relaxed">내 경기 일정과 참가 이력을 확인하세요</p>
            </div>
          </Link>
          
          <Link href="/profile">
            <div className="bg-violet-50 border-2 border-violet-200 hover:border-violet-300 p-5 rounded-lg hover:bg-violet-100 transition-all duration-200 transform hover:scale-105">
              <div className="flex items-start justify-between mb-3">
                <div className="text-2xl">👤</div>
                <div className="bg-violet-100 text-violet-800 px-2 py-1 rounded text-xs font-medium">
                  회원 기능
                </div>
              </div>
              <h4 className="text-base font-semibold text-violet-900 mb-2">회원 목록</h4>
              <p className="text-sm text-gray-600 leading-relaxed">회원 목록과 내 정보를 관리합니다</p>
            </div>
          </Link>
        </div>
      </div>

      <div className="mt-8 p-6 bg-gradient-to-r from-red-50 to-pink-50 border-2 border-red-200 rounded-lg shadow-sm">
        <div className="flex items-center mb-3">
          <div className="text-2xl mr-3">🛡️</div>
          <h3 className="text-red-800 font-semibold text-lg">관리자 권한 안내</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-red-700 text-sm">
          <div className="space-y-2">
            <p className="flex items-center"><span className="text-red-500 mr-2">•</span>경기 일정을 생성하고 관리할 수 있습니다</p>
            <p className="flex items-center"><span className="text-red-500 mr-2">•</span>회원 정보와 권한을 관리할 수 있습니다</p>
            <p className="flex items-center"><span className="text-red-500 mr-2">•</span>모든 경기 결과와 출석 현황을 확인할 수 있습니다</p>
          </div>
          <div className="space-y-2">
            <p className="flex items-center"><span className="text-red-500 mr-2">•</span>시스템의 모든 기능에 접근할 수 있습니다</p>
            <p className="flex items-center"><span className="text-red-500 mr-2">•</span>관리자도 일반 회원으로서 경기에 참여할 수 있습니다</p>
            <p className="flex items-center"><span className="text-red-500 mr-2">•</span>클럽 운영과 관련된 모든 데이터를 관리합니다</p>
          </div>
        </div>
      </div>
    </div>
  );
}

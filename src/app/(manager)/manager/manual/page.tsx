'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { 
  ArrowLeft, 
  BookOpen, 
  Calendar, 
  Coins, 
  Tv, 
  ClipboardList, 
  User, 
  Info, 
  Sparkles,
  ChevronRight,
  Menu,
  X,
  Bell,
  Zap,
  Swords,
  CalendarDays,
  Trophy,
  MessageSquarePlus
} from 'lucide-react';

import { useUser } from '@/hooks/useUser';

type TabType = 'admin-players-today' | 'admin-match-results' | 'admin-team-management' | 'admin-tournament-matches' | 'admin-pair-tournament-settings' | 'admin-tournament-bracket' | 'admin-members' | 'admin-notifications';

export default function ManualPage() {
  const [activeTab, setActiveTab] = useState<TabType>('admin-players-today');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { profile, loading } = useUser();
  const router = useRouter();



  const menuItems = [
    { id: 'admin-players-today', label: '⚡ 오늘 경기 관리', icon: Swords, color: 'text-sky-500 bg-sky-50 hover:bg-sky-100/70' },
    { id: 'admin-match-results', label: '🏆 게임 결과 조회', icon: Trophy, color: 'text-rose-500 bg-rose-50 hover:bg-rose-100/70' },
    { id: 'admin-team-management', label: '🤝 대회 팀 관리', icon: User, color: 'text-orange-500 bg-orange-50 hover:bg-orange-100/70' },
    { id: 'admin-tournament-matches', label: '🎪 대회 일정 관리', icon: CalendarDays, color: 'text-indigo-500 bg-indigo-50 hover:bg-indigo-100/70' },
    { id: 'admin-pair-tournament-settings', label: '👥 페어 대회 설정', icon: ClipboardList, color: 'text-teal-500 bg-teal-50 hover:bg-teal-100/70' },
    { id: 'admin-tournament-bracket', label: '📊 대회 대진표', icon: Tv, color: 'text-purple-500 bg-purple-50 hover:bg-purple-100/70' },
    { id: 'admin-members', label: '👥 회원 정보 운영', icon: User, color: 'text-blue-500 bg-blue-50 hover:bg-blue-100/70' },
    { id: 'admin-notifications', label: '📢 공지사항 발송', icon: Bell, color: 'text-pink-500 bg-pink-50 hover:bg-pink-100/70' },
  ] as const;

  return (
    <div className="min-h-screen bg-gradient-to-tr from-slate-50 via-gray-50 to-blue-50/30 pb-16">
      {/* ── 다크 그라디언트 헤더 ── */}
      <div className="max-w-6xl mx-auto px-2.5 mt-0">
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          <div className="relative z-10 flex items-center justify-between px-1">
            <div className="space-y-0.5 pl-2">
              <h1 className="text-xl font-bold tracking-tight">관리자 사용 설명서</h1>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">관리자 시스템 기능 및 운영 가이드를 확인합니다.</p>
            </div>
            <Link href="/admin">
              <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                홈
              </Button>
            </Link>
          </div>
        </section>
      </div>

      {/* 모바일 전용 상단 메뉴 토글 바 */}
      <div className="lg:hidden bg-white/90 backdrop-blur-md border-b border-gray-100 px-4 py-2.5 sticky top-0 z-40 shadow-sm flex items-center justify-between">
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 px-3 py-2 rounded-xl border border-slate-200/60 transition-colors cursor-pointer"
        >
          {isMenuOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          <span>목차 {isMenuOpen ? '닫기' : '열기'}</span>
        </button>
        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100/50">
          현재: {menuItems.find(item => item.id === activeTab)?.label}
        </span>
      </div>

      <div className="max-w-6xl mx-auto px-2.5 mt-4 sm:mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* 가이드 목차 (PC에서는 상시 노출, 모바일에서는 토글 상태에 따라 노출) */}
          <div className={`lg:col-span-4 bg-white/95 backdrop-blur-md border border-gray-100 rounded-2xl p-4 shadow-sm space-y-2.5 sticky top-20 z-30 lg:z-10 ${
            isMenuOpen ? 'block' : 'hidden lg:block'
          }`}>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">가이드 목차</h2>
            <div className="space-y-1">
              {menuItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setIsMenuOpen(false); // 항목 선택 시 모바일 메뉴 자동 숨김
                    }}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer ${
                      isActive 
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-600/10 translate-x-1' 
                        : 'text-slate-600 hover:text-slate-900 ' + item.color
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className={`p-1.5 rounded-lg transition-colors ${isActive ? 'bg-white/20 text-white' : ''}`}>
                        <Icon className="size-4" />
                      </div>
                      <span>{item.label}</span>
                    </div>
                    <ChevronRight className={`size-3.5 opacity-50 transition-transform ${isActive ? 'rotate-90 text-white' : ''}`} />
                  </button>
                );
              })}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-100 text-center">
              <a 
                href="/admin_manual.md" 
                download="admin_manual.md"
                className="inline-flex items-center justify-center gap-2 text-xs text-blue-600 hover:text-blue-800 font-semibold px-4 py-2 rounded-lg bg-blue-50/50 hover:bg-blue-50 transition-colors w-full"
              >
                📥 원본 마크다운 파일 받기
              </a>
            </div>
          </div>

          {/* 우측 가이드 상세 영역 */}
          <div className="lg:col-span-8 space-y-6">

            {/* 12. 오늘 경기 관리 */}
            {activeTab === 'admin-players-today' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-sky-50 text-sky-600 rounded-2xl">
                    <Swords className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-sky-600 font-semibold uppercase tracking-wider">ADMIN SECTION 01</span>
                    <h3 className="text-2xl font-bold text-slate-800">오늘 경기 생성 및 배정</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  오늘 정기 모임에 참석한 선수들의 출석 체크 데이터를 기반으로 게임을 유연하게 자동 또는 수동 생성 및 배정합니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">📊 1인당 목표 경기수 설정</h4>
                    <p className="text-sm text-slate-600 mt-1">1~3경기 중 원하는 게임 수를 지정하면 전원 고르게 게임을 돌 수 있도록 적합한 대진 알고리즘이 예상 경기수를 계산합니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🎯 세분화된 경기 생성 방식</h4>
                    <p className="text-sm text-slate-600 mt-1"><strong>레벨별 경기:</strong> 동등한 수준의 파트너 매칭<br/><strong>랜덤 경기:</strong> 무작위 혼합 복식 구성<br/><strong>혼합복식:</strong> 성별 밸런스를 조정한 남녀 매칭<br/><strong>수동 배정:</strong> 직접 빈칸에 선수를 커스텀 배치</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">✨ 즉시 배정 및 초기화</h4>
                    <p className="text-sm text-slate-600 mt-1">대기 목록이 생성되면 하단의 버튼을 통해 실시간 코트 슬롯에 즉각 배정하거나, 맘에 안 들 경우 경기를 초기화하고 재배정할 수 있습니다.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 13. 게임 결과 조회 */}
            {activeTab === 'admin-match-results' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-rose-50 text-rose-600 rounded-2xl">
                    <Trophy className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-rose-600 font-semibold uppercase tracking-wider">ADMIN SECTION 02</span>
                    <h3 className="text-2xl font-bold text-slate-800">게임 결과 조회</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  오늘 배정되어 기록 완료된 경기들의 종합 및 세부 스코어 보드를 조회합니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">👁️ 모바일 조회 전용 모드</h4>
                    <p className="text-sm text-slate-600 mt-1">모바일 화면의 번거로운 입력을 없애기 위해 결과 조회 전용 텍스트 방식으로 고안되었습니다. 모바일에서는 점수 수정이나 저장 버튼이 숨김 처리되어 데이터 안전성을 확보합니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🔢 깔끔한 정수형 표기</h4>
                    <p className="text-sm text-slate-600 mt-1">불필요한 소수점을 제거하여 스코어판을 깔끔한 정수 형식으로만 한눈에 확인하도록 지원합니다.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 14. 대회 팀 관리 */}
            {activeTab === 'admin-team-management' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-orange-50 text-orange-600 rounded-2xl">
                    <User className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-orange-600 font-semibold uppercase tracking-wider">ADMIN SECTION 03</span>
                    <h3 className="text-2xl font-bold text-slate-800">대회 팀 관리</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  클럽 내 자체 대회나 토너먼트에 출전할 팀(복식 페어) 조합을 등록하고 관리합니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">👥 페어 빌더 및 등록</h4>
                    <p className="text-sm text-slate-600 mt-1">두 명의 선수를 선택하여 하나의 고유 팀으로 등록합니다. 등록된 팀은 대회 경기 조편성이나 토너먼트 시드의 최소 단위가 됩니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🗑️ 팀 리스트 정비</h4>
                    <p className="text-sm text-slate-600 mt-1">등록된 복식 페어를 삭제하거나, 재구성 시 기존 팀 리스트를 정비할 수 있는 관리 도구입니다.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 15. 대회 일정 관리 */}
            {activeTab === 'admin-tournament-matches' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                    <CalendarDays className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-indigo-600 font-semibold uppercase tracking-wider">ADMIN SECTION 04</span>
                    <h3 className="text-2xl font-bold text-slate-800">대회 경기 및 일정 관리</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  토너먼트나 예선 리그 형식의 자체 대회를 개최하고, 회차별 일정을 코트에 투입하여 진행합니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🏆 리그 / 토너먼트 셋업</h4>
                    <p className="text-sm text-slate-600 mt-1">대회 성격에 맞게 리그전이나 토너먼트 형식으로 단판 또는 다전제 매치들을 생성할 수 있습니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🏟️ 코트 실시간 배정</h4>
                    <p className="text-sm text-slate-600 mt-1">생성된 경기 중 현재 빈 코트가 생기면 즉각 투입하여 실시간 상태를 '진행중'으로 변경하고 시간 및 점수를 모니터링합니다.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 16. 페어 대회 설정 */}
            {activeTab === 'admin-pair-tournament-settings' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-teal-50 text-teal-600 rounded-2xl">
                    <ClipboardList className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-teal-600 font-semibold uppercase tracking-wider">ADMIN SECTION 05</span>
                    <h3 className="text-2xl font-bold text-slate-800">페어 대회 설정</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  선수들 간의 복식 페어를 조합하고 그룹화하여 레벨 격차가 없는 공정한 자체 대회를 조율합니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">⚖️ 핸디캡 및 레벨 밸런싱</h4>
                    <p className="text-sm text-slate-600 mt-1">선수별 등급(A/B/C)이나 코인 가중치 데이터 등을 계산하여 복식 조합 간 팽팽한 대진이 나오도록 설정합니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">📅 조 편성 및 라운드 생성</h4>
                    <p className="text-sm text-slate-600 mt-1">대회 예선 진행을 위한 하위 그룹 조(A조, B조 등)를 신속하게 편성하고 경기 생성 마법사를 가동합니다.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 17. 대회 대진표 */}
            {activeTab === 'admin-tournament-bracket' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-purple-50 text-purple-600 rounded-2xl">
                    <Tv className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-purple-600 font-semibold uppercase tracking-wider">ADMIN SECTION 06</span>
                    <h3 className="text-2xl font-bold text-slate-800">대회 대진표 (브라켓)</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  현재 진행 중인 토너먼트의 전반적인 상황판 및 승자/패자조 흐름을 시각적 트리 형태로 한눈에 보여줍니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">📊 비주얼 브라켓 구성</h4>
                    <p className="text-sm text-slate-600 mt-1">16강, 8강, 준결승, 결승전으로 흐르는 토너먼트 트리를 렌더링하여 관중이나 대기 선수들이 진행률을 쉽게 인지하게 돕습니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🔄 실시간 스코어 연동</h4>
                    <p className="text-sm text-slate-600 mt-1">대회 경기가 끝나는 즉시 상위 시드로 자동 승자가 올라가며 대진 상태가 리프레시됩니다.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 18. 회원 정보 운영 */}
            {activeTab === 'admin-members' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                    <User className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-blue-600 font-semibold uppercase tracking-wider">ADMIN SECTION 07</span>
                    <h3 className="text-2xl font-bold text-slate-800">회원 정보 및 권한 운영</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  가입된 회원 리스트를 통합 관리하고 레벨 등 주요 정보 수정 및 새로운 회원을 등록합니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🔑 등급(레벨) 및 정보 일체 변경</h4>
                    <p className="text-sm text-slate-600 mt-1">회원의 성별, 배드민턴 실력 등급(A1~N1) 정보를 수정합니다. 레벨은 경기 대진 생성 시 평균 밸런싱의 핵심 팩터로 동작하므로 주기적 관리가 중요합니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🛡️ 매니저 권한 이양</h4>
                    <p className="text-sm text-slate-600 mt-1">일반 회원(user)에게 매니저(manager) 지위를 할당하여 공동으로 대진표 생성 및 결과 관리를 수행하도록 역할을 양도할 수 있습니다.</p>
                  </div>
                </div>
              </div>
            )}

            {/* 19. 공지사항 발송 */}
            {activeTab === 'admin-notifications' && (
              <div className="bg-white border border-gray-100 rounded-3xl p-6 sm:p-8 shadow-sm transition-all hover:shadow-md animate-fadeIn">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
                  <div className="p-3 bg-pink-50 text-pink-600 rounded-2xl">
                    <Bell className="size-6" />
                  </div>
                  <div>
                    <span className="text-xs text-pink-600 font-semibold uppercase tracking-wider">ADMIN SECTION 08</span>
                    <h3 className="text-2xl font-bold text-slate-800">공지사항 및 알림 발송</h3>
                  </div>
                </div>

                <p className="text-slate-600 leading-relaxed mb-6">
                  클럽 소식 및 급한 공지를 전체 또는 대상 집단을 선별하여 발송하고, 읽음 여부를 실시간 추적합니다.
                </p>

                <div className="space-y-4">
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🎯 다양한 알림 타겟팅</h4>
                    <p className="text-sm text-slate-600 mt-1">전체 회원, 남성 회원, 여성 회원 등 대상별 맞춤 발송을 지원하며, 일반 알림, 경기 결과, 시스템 알림 등으로 타입을 구분하여 시인성을 높입니다.</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <h4 className="font-bold text-slate-800">🗳️ 투표 및 설문조사 발송</h4>
                    <p className="text-sm text-slate-600 mt-1">의견을 수렴할 수 있는 선착순 제한 및 다지선다 형태의 설문을 즉각 구성하여 투표를 진행하고 CSV 형태로 투표결과를 다운로드할 수 있습니다.</p>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>
      </div>
    </div>
  );
}

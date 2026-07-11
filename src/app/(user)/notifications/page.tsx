"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/hooks/useUser";
import { useClub } from "@/hooks/useClub";
import { getSupabaseClient } from "@/lib/supabase";
import {
  Bell,
  Check,
  CheckCheck,
  RefreshCw,
  Filter,
  BellOff,
  ArrowLeft,
  FileText,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type NotificationRow = {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  file_url?: string | null;
  file_name?: string | null;
  survey_id?: string | null;
  surveys?: {
    id: string;
    question: string;
    description: string | null;
    options: string[];
    is_active: boolean;
    my_response?: string | null;
    max_responses?: number | null;
    option_limits?: Record<string, number> | null;
    stats?: Record<string, number>;
    total_responses?: number;
  } | null;
};

type FilterMode = "unread" | "all";

const TYPE_LABELS: Record<string, string> = {
  general: "일반 알림",
  match_preparation: "경기 준비",
  match_result: "경기 결과",
  schedule_change: "일정 변경",
  system: "시스템 알림",
  challenge: "도전 알림",
  survey: "설문조사",
  notice: "공지사항",
};

const TYPE_COLORS: Record<string, string> = {
  general: "bg-slate-100 text-slate-700",
  match_preparation: "bg-indigo-100 text-indigo-700",
  match_result: "bg-emerald-100 text-emerald-700",
  schedule_change: "bg-amber-100 text-amber-700",
  system: "bg-purple-100 text-purple-700",
  challenge: "bg-rose-100 text-rose-700",
  survey: "bg-rose-100 text-rose-700",
  notice: "bg-indigo-100 text-indigo-700",
};

function formatMessageWithBreaks(message: string): React.ReactNode {
  if (!message) return null;

  let lines: string[] = [];
  if (message.includes('\n')) {
    lines = message.split('\n');
  } else {
    const segments = message.split(/([.!?])\s+/g);
    let current = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg === "." || seg === "!" || seg === "?") {
        current += seg;
        lines.push(current.trim());
        current = "";
      } else {
        current += seg;
      }
    }
    if (current.trim()) lines.push(current.trim());
  }

  return (
    <>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1.5" />;
        }
        
        const isHeader = trimmed.startsWith('🚨') || trimmed.startsWith('📢') || trimmed.startsWith('📌');
        const isDivider = trimmed.includes('━━') || trimmed.includes('━━━') || trimmed.includes('----');
        
        let lineClass = "block leading-relaxed text-slate-600";
        if (isHeader) {
          lineClass = "block font-extrabold text-[13px] text-indigo-950 mb-1 mt-0.5";
        } else if (isDivider) {
          lineClass = "block text-slate-300 font-light tracking-tighter opacity-70 my-0.5 overflow-hidden whitespace-nowrap";
        }

        return (
          <span key={idx} className={lineClass}>
            {trimmed}
          </span>
        );
      })}
    </>
  );
}

export default function NotificationsPage() {
  const { user, loading } = useUser();
  const { clubId } = useClub();
  const supabase = getSupabaseClient();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterMode>("unread");
  const [activeTab, setActiveTab] = useState<'notice' | 'notification'>('notice');
  const [submittingSurveyId, setSubmittingSurveyId] = useState<string | null>(null);

  const fetchNotifications = async () => {
    if (!user) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch("/api/user/notifications");
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `서버 오류 (${res.status})`);
      }
      const { notifications: data } = await res.json();
      setNotifications(data || []);
    } catch (e: any) {
      setError(e.message || "알림을 불러오는 데 실패했습니다.");
    } finally {
      setFetching(false);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
    } catch (e) {
      console.error("읽음 처리 실패:", e);
    }
  };

  const markAllAsRead = async () => {
    try {
      await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (e) {
      console.error("전체 읽음 처리 실패:", e);
    }
  };

  const submitSurveyResponse = async (notificationId: string, surveyId: string, option: string) => {
    setSubmittingSurveyId(surveyId);
    try {
      const res = await fetch("/api/user/surveys/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survey_id: surveyId, selected_option: option }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "설문 응답 제출 실패");
      }

      // 로컬 알림 상태 업데이트 (선택 값 설정, 응답 통계 카운트 갱신 및 자동으로 알림 읽음 처리)
      setNotifications((prev) =>
        prev.map((n) => {
          if (n.id === notificationId && n.surveys) {
            const oldResponse = n.surveys.my_response;
            const newStats = { ...(n.surveys.stats || {}) };
            
            // Decrement old response count
            if (oldResponse && newStats[oldResponse] !== undefined) {
              newStats[oldResponse] = Math.max(0, newStats[oldResponse] - 1);
            }
            // Increment new response count
            newStats[option] = (newStats[option] || 0) + 1;

            const oldTotal = n.surveys.total_responses || 0;
            const newTotal = oldResponse ? oldTotal : oldTotal + 1;

            const updatedSurvey = {
              ...n.surveys,
              my_response: option,
              stats: newStats,
              total_responses: newTotal,
            };
            return { ...n, is_read: true, surveys: updatedSurvey };
          }
          return n;
        })
      );

      // 백엔드에도 읽음 처리
      await fetch("/api/user/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [notificationId] }),
      });

      alert(`설문 응답(${option})이 제출되었습니다.`);
    } catch (e: any) {
      alert(e.message || "설문 응답 제출 중 오류가 발생했습니다.");
    } finally {
      setSubmittingSurveyId(null);
    }
  };

  useEffect(() => {
    if (!user || !clubId) return;
    fetchNotifications();

    const channel = supabase
      .channel("user-notifications-page")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload: any) => {
          // Only refresh if the notification belongs to the active club
          if (payload.new?.club_id && payload.new.club_id !== clubId) return;
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, clubId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb]">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 animate-spin text-indigo-600" />
          <span className="text-slate-600 font-medium text-sm">불러오는 중...</span>
        </div>
      </div>
    );
  }

  const filteredByType = notifications.filter((n) =>
    activeTab === "notice" ? n.type === "notice" : n.type !== "notice"
  );
  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const tabUnreadCount = filteredByType.filter((n) => !n.is_read).length;
  const displayed =
    filter === "unread"
      ? filteredByType.filter((n) => !n.is_read)
      : filteredByType;

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900 pb-16">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
        {/* ── 다크 그라디언트 헤더 ── */}
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          <div className="relative z-10 flex flex-col gap-4">
            
            {/* 상단 네비 */}
            <div className="flex items-center justify-between px-1">
              <div className="space-y-0.5 pl-2">
                <h1 className="text-xl font-bold tracking-tight">공지사항 및 알림</h1>
                <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">새로운 클럽 공지사항과 내 알림을 확인합니다.</p>
              </div>
              <Link href="/dashboard">
                <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  홈
                </Button>
              </Link>
            </div>

            {/* 미읽음 요약 카드 */}
            <div className="flex items-center justify-between rounded-[18px] bg-white/10 border border-white/10 p-3.5 backdrop-blur-sm">
              <div className="space-y-0.5">
                <span className="text-[11px] text-indigo-200 font-medium">
                  읽지 않은 알림
                </span>
                <div className="flex items-center gap-1">
                  <Bell className="h-4 w-4 text-amber-400" />
                  <span className="text-xl font-black text-amber-300">
                    {unreadCount}
                  </span>
                  <span className="text-xs font-semibold text-slate-200">개</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="flex items-center gap-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-white transition"
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    모두 읽음
                  </button>
                )}
                <button
                  onClick={fetchNotifications}
                  disabled={fetching}
                  className="flex items-center gap-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${fetching ? "animate-spin" : ""}`} />
                  새로고침
                </button>
              </div>
            </div>

          </div>
        </section>

        {/* ── 본문 ── */}
        {/* 오류 배너 */}
        {error && (
          <div className="rounded-[24px] border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-2 shadow-sm">
            <BellOff className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* 대분류 공지사항 / 알림 탭 */}
        <div className="grid grid-cols-2 gap-2 p-1 bg-slate-200/60 rounded-[20px] border border-slate-200/30">
          <button
            onClick={() => setActiveTab('notice')}
            className={`py-3 text-sm font-extrabold rounded-2xl transition duration-200 flex items-center justify-center gap-1.5 ${
              activeTab === 'notice'
                ? 'bg-white text-indigo-950 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📢 공지사항</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              activeTab === 'notice' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-300/60 text-slate-600'
            }`}>
              {notifications.filter(n => n.type === 'notice').length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('notification')}
            className={`py-3 text-sm font-extrabold rounded-2xl transition duration-200 flex items-center justify-center gap-1.5 ${
              activeTab === 'notification'
                ? 'bg-white text-indigo-950 shadow-sm'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>🔔 일반 알림</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              activeTab === 'notification' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-300/60 text-slate-600'
            }`}>
              {notifications.filter(n => n.type !== 'notice').length}
            </span>
          </button>
        </div>

        {/* 필터 및 목록 영역 */}
        <section className="rounded-[24px] bg-white px-3 py-3 sm:px-4 sm:py-4 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">필터</span>
            </div>
            <div className="flex rounded-xl bg-slate-100 border border-slate-200/60 p-0.5 gap-0.5">
              <button
                onClick={() => setFilter("unread")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  filter === "unread"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                읽지 않음
                {tabUnreadCount > 0 && (
                  <span
                    className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                      filter === "unread"
                        ? "bg-rose-600 text-white"
                        : "bg-rose-100 text-rose-600"
                    }`}
                  >
                    {tabUnreadCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => setFilter("all")}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                  filter === "all"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                전체
                <span
                  className={`ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
                    filter === "all"
                      ? "bg-slate-900 text-white"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {filteredByType.length}
                </span>
              </button>
            </div>
          </div>

          {/* 로딩 */}
          {fetching && (
            <div className="text-center py-8 text-slate-400 text-sm">
              불러오는 중...
            </div>
          )}

          {/* 알림 없음 */}
          {!fetching && displayed.length === 0 && (
            <div className="rounded-[20px] bg-slate-50 border border-slate-200/50 p-10 text-center shadow-sm">
              <BellOff className="h-8 w-8 mx-auto mb-3 text-slate-300" />
              <p className="font-semibold text-slate-500 text-sm">
                {filter === "unread"
                  ? "읽지 않은 알림이 없습니다."
                  : "알림이 없습니다."}
              </p>
              {filter === "unread" && notifications.length > 0 && (
                <button
                  onClick={() => setFilter("all")}
                  className="mt-3 text-xs text-indigo-600 font-semibold hover:underline"
                >
                  전체 알림 보기 →
                </button>
              )}
            </div>
          )}

          {/* 알림 목록 */}
          {!fetching && displayed.length > 0 && (
            <div className="flex flex-col gap-3">
              {displayed.map((n) => {
                const typeLabel = TYPE_LABELS[n.type] ?? n.type;
                const typeColor =
                  TYPE_COLORS[n.type] ?? "bg-slate-100 text-slate-600";
                const survey = n.surveys;

                return (
                  <div
                    key={n.id}
                    className={`rounded-[20px] border p-4 transition-all duration-200 ${
                      n.is_read
                        ? "bg-slate-50 border-slate-200/60 hover:bg-slate-100/70"
                        : "bg-indigo-50/50 border-indigo-200 shadow-sm"
                    }`}
                  >
                    {/* 헤더: 타입 뱃지 + 날짜 */}
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeColor}`}
                      >
                        <Bell className="h-3 w-3 shrink-0" />
                        {typeLabel}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {new Date(n.created_at).toLocaleString("ko-KR")}
                      </span>
                    </div>

                    {/* 제목 */}
                    <h3
                      className={`font-bold text-sm mb-1.5 ${
                        n.is_read ? "text-slate-700" : "text-indigo-900"
                      }`}
                    >
                      {n.title}
                    </h3>

                    {/* 내용 — 마침표 뒤 줄바꿈 */}
                    <div className="text-xs text-slate-600 space-y-0.5">
                      {formatMessageWithBreaks(n.message)}
                    </div>

                    {/* 파일 첨부 영역 */}
                    {n.file_url && (
                      <div className="mt-3 p-2.5 rounded-2xl bg-slate-50 border border-slate-200/50 flex items-center justify-between gap-3 hover:bg-slate-100/75 transition duration-150">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-4 w-4 text-indigo-500 shrink-0" />
                          <span className="text-[11px] font-bold text-slate-700 truncate">{n.file_name || '첨부파일'}</span>
                        </div>
                        <a
                          href={n.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          download={n.file_name || '첨부파일'}
                          className="inline-flex items-center gap-1 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 text-xs font-bold transition shrink-0"
                        >
                          <Download className="h-3.5 w-3.5" />
                          다운로드
                        </a>
                      </div>
                    )}

                    {survey && (() => {
                      const isSurveyFull = survey.max_responses !== null && 
                        survey.max_responses !== undefined && 
                        (survey.total_responses || 0) >= survey.max_responses && 
                        !survey.my_response;

                      return (
                        <div className="mt-4 p-3 rounded-[16px] bg-slate-100/80 border border-slate-200/50 space-y-3">
                          <div className="flex justify-between items-center text-[11px] font-bold text-slate-700">
                            <span>설문 참여</span>
                            {survey.max_responses !== null && survey.max_responses !== undefined && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] ${isSurveyFull ? 'bg-rose-100 text-rose-700 font-bold' : 'bg-slate-200 text-slate-600 font-semibold'}`}>
                                전체 정원: {survey.total_responses || 0}/{survey.max_responses}명 {isSurveyFull && "(선착순 마감)"}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {Array.isArray(survey.options) && survey.options.map((opt) => {
                              const isSelected = survey.my_response === opt;
                              const isSurveyActive = survey.is_active;
                              const optCount = survey.stats?.[opt] || 0;
                              const optLimit = survey.option_limits?.[opt];
                              const isOptLimited = optLimit !== undefined && optLimit !== null;
                              const isOptFull = isOptLimited && optCount >= Number(optLimit);
                              const isDisabled = !isSurveyActive || 
                                submittingSurveyId === survey.id || 
                                (isSurveyFull && !isSelected) || 
                                (isOptFull && !isSelected);

                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={isDisabled}
                                  onClick={() => submitSurveyResponse(n.id, survey.id, opt)}
                                  className={`px-4 py-2 text-xs font-bold rounded-xl transition duration-150 relative flex items-center justify-between gap-3 ${
                                    isSelected
                                      ? "bg-indigo-600 text-white shadow-sm"
                                      : "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 disabled:bg-slate-50 disabled:text-slate-400 disabled:border-slate-100"
                                  }`}
                                >
                                  <span className="flex items-center gap-1.5">
                                    {opt}
                                    {isSelected && <Check className="h-3.5 w-3.5" />}
                                  </span>
                                  {isOptLimited && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold shrink-0 ${
                                      isSelected 
                                        ? "bg-indigo-700 text-indigo-100" 
                                        : isOptFull 
                                          ? "bg-rose-100 text-rose-700" 
                                          : "bg-slate-100 text-slate-500"
                                    }`}>
                                      {optCount}/{optLimit}명 {isOptFull && !isSelected && "마감"}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                          {!survey.is_active && (
                            <div className="text-[10px] text-slate-400 font-medium">※ 종료된 설문조사입니다.</div>
                          )}
                          {survey.is_active && survey.my_response && (
                            <div className="text-[10px] text-indigo-600 font-semibold">※ 다른 옵션을 클릭하면 응답을 수정할 수 있습니다.</div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 읽음 버튼 */}
                    {!n.is_read && (
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => markAsRead(n.id)}
                          className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-full transition"
                        >
                          <Check className="h-3 w-3" />
                          읽음 처리
                        </button>
                      </div>
                    )}

                    {/* 읽은 상태 표시 */}
                    {n.is_read && (
                      <div className="mt-2 flex justify-end">
                        <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                          <CheckCheck className="h-3 w-3" />
                          읽음
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

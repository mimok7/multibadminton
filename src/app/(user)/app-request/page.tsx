'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle, Clock, RefreshCw, Send, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/useUser';
import { isAdminRole, isManagerRole } from '@/lib/auth';

type AppRequestItem = {
  id: string;
  requester_id: string;
  category: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  requested_at: string;
  completed_at: string | null;
  menu_name: string | null;
  requester?: {
    full_name: string | null;
    username: string | null;
  } | null;
};

function getStatusBadgeClass(status: string) {
  if (status === 'completed') return 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20';
  if (status === 'in_progress') return 'bg-sky-500/10 text-sky-600 border border-sky-500/20';
  if (status === 'rejected') return 'bg-rose-500/10 text-rose-600 border border-rose-500/20';
  return 'bg-amber-500/10 text-amber-600 border border-amber-500/20'; // pending
}

function getStatusLabel(status: string) {
  if (status === 'completed') return '완료';
  if (status === 'in_progress') return '진행 중';
  if (status === 'rejected') return '반려';
  return '대기 중';
}

function formatDate(isoString: string) {
  try {
    const d = new Date(isoString);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return isoString;
  }
}

export default function AppRequestPage() {
  const { profile } = useUser();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [requests, setRequests] = useState<AppRequestItem[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');
  
  const [category, setCategory] = useState('');
  const [menuName, setMenuName] = useState('');
  const [customMenuName, setCustomMenuName] = useState('');
  const [content, setContent] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [customMessages, setCustomMessages] = useState<Record<string, string>>({});

  const handleCopyContent = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const loadRequests = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/app-requests', { credentials: 'include' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || '요청 목록을 불러오지 못했습니다.');
      }
      setRequests(data.requests || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !content) {
      alert('분류와 내용을 입력해주세요.');
      return;
    }

    const finalMenuName = menuName === '기타 (직접 입력)' ? customMenuName : menuName;

    try {
      setSaving(true);
      const res = await fetch('/api/app-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          category, 
          menu_name: finalMenuName || null,
          content 
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || '요청 전송에 실패했습니다.');
      }
      setCategory('');
      setMenuName('');
      setCustomMenuName('');
      setContent('');
      alert('앱 수정 요청이 정상적으로 전송되었습니다.');
      await loadRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateStatus = async (requestId: string, nextStatus: string, customMessage?: string) => {
    try {
      setUpdatingId(requestId);
      const res = await fetch('/api/app-requests', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          request_id: requestId, 
          status: nextStatus,
          notification_message: customMessage || ''
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || '상태 변경에 실패했습니다.');
      }
      setCustomMessages(prev => ({ ...prev, [requestId]: '' }));
      await loadRequests();
    } catch (err) {
      alert(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setUpdatingId(null);
    }
  };

  const isAdmin = isAdminRole(profile?.role) || isManagerRole(profile?.role);

  const filteredRequests = requests.filter(item => 
    activeTab === 'active' ? item.status !== 'completed' : item.status === 'completed'
  );

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 pb-12">
      <div className="mx-auto w-full max-w-6xl px-2.5 pt-0 pb-4 sm:px-6 sm:pt-0 sm:pb-8">
        
        {/* Header Banner */}
        <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
          <div className="relative z-10 flex items-center justify-between px-1">
            <div className="space-y-0.5 pl-2">
              <h1 className="text-xl font-bold tracking-tight">앱 수정 요청</h1>
              <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">버그 제보나 기능 건의사항을 관리자에게 직접 요청할 수 있습니다.</p>
            </div>
            
            <Link href="/dashboard">
              <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                홈
              </Button>
            </Link>
          </div>
        </section>

        {/* 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* LEFT: Request Submission Form */}
          <section className="lg:col-span-5 rounded-3xl bg-white border border-slate-100 px-5 py-6 shadow-sm hover:shadow-md transition">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Submit Request</p>
                <h2 className="text-lg font-bold text-slate-900">새 수정 요청 작성</h2>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">요청 분류</label>
                <div className="relative">
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    required
                    className="block w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 cursor-pointer"
                  >
                    <option value="">수정 범주를 선택하세요</option>
                    <option value="버그 수정 / 오작동">버그 수정 / 오작동</option>
                    <option value="기능 건의 / 추가">기능 건의 / 추가</option>
                    <option value="디자인 / 화면 개선">디자인 / 화면 개선</option>
                    <option value="데이터 수정 (점수, 이름 등)">데이터 수정 (점수, 이름 등)</option>
                    <option value="기타">기타</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">대상 메뉴</label>
                <div className="relative">
                  <select
                    value={menuName}
                    onChange={(e) => setMenuName(e.target.value)}
                    required
                    className="block w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 cursor-pointer"
                  >
                    <option value="">수정을 원하는 메뉴를 선택하세요</option>
                    <option value="공지사항/알림">공지사항/알림</option>
                    <option value="게임 제안">게임 제안</option>
                    <option value="오늘 게임">오늘 게임</option>
                    <option value="참가 신청">참가 신청</option>
                    <option value="내 게임">내 게임</option>
                    <option value="회원 목록">회원 목록</option>
                    <option value="대회 대진표">대회 대진표</option>
                    <option value="상품 교환">상품 교환</option>
                    <option value="사용자 설명서">사용자 설명서</option>
                    <option value="기타 (직접 입력)">기타 (직접 입력)</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-slate-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {menuName === '기타 (직접 입력)' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">메뉴명 직접 입력</label>
                  <input
                    type="text"
                    value={customMenuName}
                    onChange={(e) => setCustomMenuName(e.target.value)}
                    placeholder="예: 관리자 페이지, 로그인 화면 등"
                    required
                    className="block w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3.5 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">상세 내용</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="예: 경기 결과 탭에서 승률이 제대로 갱신되지 않습니다. 수정 부탁드립니다!"
                  required
                  rows={6}
                  className="block w-full rounded-2xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-sm text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-400"
                />
              </div>

              <Button
                type="submit"
                disabled={saving}
                className="h-12 w-full mt-4 rounded-2xl bg-indigo-600 font-semibold text-white shadow-lg shadow-indigo-600/15 hover:bg-indigo-700 transition active:scale-98"
              >
                <Send className="mr-2 h-4 w-4" />
                {saving ? '요청 보내는 중...' : '수정 요청 보내기'}
              </Button>
            </form>
          </section>

          {/* RIGHT: Request History List */}
          <div className="lg:col-span-7 space-y-6">
            <section className="rounded-3xl bg-white border border-slate-100 px-5 py-6 shadow-sm hover:shadow-md transition">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-4 mb-5 gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Request History</p>
                  <h2 className="text-lg font-bold text-slate-900">
                    {isAdmin ? '전체 수정 요청 목록' : '내 수정 요청 기록'}
                  </h2>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setActiveTab('active')}
                      className={`rounded-lg px-3 py-1.5 transition-all duration-200 ${
                        activeTab === 'active'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      진행 중 ({requests.filter(r => r.status !== 'completed').length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('completed')}
                      className={`rounded-lg px-3 py-1.5 transition-all duration-200 ${
                        activeTab === 'completed'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      완료 목록 ({requests.filter(r => r.status === 'completed').length})
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      void loadRequests();
                    }}
                    disabled={loading}
                    className="rounded-full p-2 border border-slate-100 hover:bg-slate-50 text-slate-500 transition-colors disabled:opacity-50"
                    title="새로고침"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {loading && requests.length === 0 ? (
                  <div className="text-center py-8 text-sm text-slate-500">불러오는 중...</div>
                ) : filteredRequests.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50/50 border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                    {activeTab === 'active' ? '진행 중인 수정 요청이 없습니다.' : '완료된 수정 요청이 없습니다.'}
                  </div>
                ) : (
                  filteredRequests.map((item) => (
                    <article key={item.id} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 transition-all hover:border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/50 pb-2.5 mb-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                            {item.category}
                          </span>
                          {isAdmin && (
                            <span className="text-[11px] font-medium text-slate-500">
                              작성자: {item.requester?.full_name || item.requester?.username || '회원'}
                            </span>
                          )}
                        </div>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getStatusBadgeClass(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </div>

                      {item.menu_name && (
                        <div className="text-[11px] font-bold text-slate-500 mb-2">
                          대상 메뉴: <span className="text-indigo-600 bg-indigo-50/50 border border-indigo-100/60 px-2 py-0.5 rounded">{item.menu_name}</span>
                        </div>
                      )}

                      <div className="relative group rounded-xl bg-slate-100/50 border border-slate-200/40 p-3 mb-3">
                        <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed pr-8">
                          {item.content}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyContent(item.id, item.content)}
                          className="absolute top-2.5 right-2.5 p-1 rounded-md text-slate-400 hover:bg-slate-200/50 hover:text-slate-600 transition"
                          title="상세내용 복사"
                        >
                          {copiedId === item.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>

                      <div className="flex flex-col gap-1 text-[11px] text-slate-400 border-t border-slate-200/30 pt-2.5">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>신청 일시: {formatDate(item.requested_at)}</span>
                        </div>
                        {item.completed_at && (
                          <div className="flex items-center gap-1 text-emerald-600 font-medium">
                            <CheckCircle className="h-3 w-3 shrink-0" />
                            <span>완료 일시: {formatDate(item.completed_at)}</span>
                          </div>
                        )}
                      </div>

                      {/* Admin controls for updating request status */}
                      {isAdmin && (
                        <div className="mt-3 pt-3 border-t border-slate-200/50 space-y-2">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={customMessages[item.id] ?? ''}
                              onChange={(e) => setCustomMessages({
                                ...customMessages,
                                [item.id]: e.target.value
                              })}
                              placeholder="신청자에게 보낼 알림 메시지 입력 (선택)..."
                              className="block w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-1.5 text-xs text-slate-900 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 placeholder-slate-400"
                            />
                            {customMessages[item.id] && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    setUpdatingId(item.id);
                                    const res = await fetch('/api/app-requests', {
                                      method: 'PUT',
                                      headers: { 'Content-Type': 'application/json' },
                                      credentials: 'include',
                                      body: JSON.stringify({ 
                                        request_id: item.id, 
                                        status: item.status, 
                                        notification_message: customMessages[item.id] 
                                      }),
                                    });
                                    if (!res.ok) throw new Error('메시지 전송에 실패했습니다.');
                                    setCustomMessages({ ...customMessages, [item.id]: '' });
                                    alert('신청자에게 알림 메시지를 보냈습니다.');
                                  } catch (err) {
                                    alert(err instanceof Error ? err.message : '오류 발생');
                                  } finally {
                                    setUpdatingId(null);
                                  }
                                }}
                                className="h-8 text-xs px-2.5 rounded-lg border-indigo-200 text-indigo-600 bg-indigo-50/50 hover:bg-indigo-50 shrink-0"
                              >
                                메시지만 전송
                              </Button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              onClick={() => void handleUpdateStatus(item.id, 'in_progress', customMessages[item.id])}
                              disabled={updatingId === item.id || item.status === 'in_progress'}
                              className="bg-sky-600 hover:bg-sky-700 text-white h-7 text-xs px-2.5 rounded-lg"
                            >
                              진행 중
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => void handleUpdateStatus(item.id, 'completed', customMessages[item.id])}
                              disabled={updatingId === item.id || item.status === 'completed'}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs px-2.5 rounded-lg"
                            >
                              완료 처리
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleUpdateStatus(item.id, 'rejected', customMessages[item.id])}
                              disabled={updatingId === item.id || item.status === 'rejected'}
                              className="border-rose-200 text-rose-600 hover:bg-rose-50 h-7 text-xs px-2.5 rounded-lg bg-white"
                            >
                              반려
                            </Button>
                          </div>
                        </div>
                      )}
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>

        </div>

      </div>
    </div>
  );
}

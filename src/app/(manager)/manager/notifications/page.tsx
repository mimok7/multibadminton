"use client";

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Bell } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase';
import { useUser } from '@/hooks/useUser';

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'general' | 'match_preparation' | 'match_result' | 'schedule_change' | 'system' | string;
  related_match_id?: string | null;
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
};

export default function AdminNotificationsPage() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const { user, isAdmin, loading } = useUser();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [users, setUsers] = useState<{ id: string; label: string; gender: string }[]>([]);
  const [form, setForm] = useState<{ user_id: string; title: string; message: string; type: string }>({ user_id: '', title: '', message: '', type: 'general' });
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [surveyTitle, setSurveyTitle] = useState('');

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.user-select-dropdown')) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);
  const [surveyOptions, setSurveyOptions] = useState<string[]>(['참석', '불참', '미정']);
  const [surveyLimits, setSurveyLimits] = useState<(number | null)[]>([null, null, null]);
  const [maxResponses, setMaxResponses] = useState<number | ''>('');
  const [surveys, setSurveys] = useState<any[]>([]);
  const [expandedOption, setExpandedOption] = useState<Record<string, string | null>>({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [groupByBroadcast, setGroupByBroadcast] = useState<boolean>(true);

  // 1. Filter rows by type
  const filteredRows = useMemo(() => {
    if (filterType === 'all') return [];
    return rows.filter(r => r.type === filterType);
  }, [rows, filterType]);

  // 2. Group rows by broadcast (if enabled)
  const displayRows = useMemo(() => {
    if (!groupByBroadcast) {
      // Not grouped: map recipient label to each row directly
      return filteredRows.map(r => {
        const recipient = users.find(u => u.id === r.user_id);
        const recipientLabel = recipient ? recipient.label : '알 수 없음';
        return {
          ...r,
          recipientLabel,
          isGrouped: false,
          total_count: 1,
          read_count: r.is_read ? 1 : 0
        };
      });
    }

    // Grouping logic: group by title, message, type, and created_at close enough (e.g. within 10s)
    const groups: any[] = [];

    filteredRows.forEach(item => {
      const itemTime = new Date(item.created_at).getTime();
      const existingGroup = groups.find(g => 
        g.title === item.title &&
        g.message === item.message &&
        g.type === item.type &&
        Math.abs(new Date(g.created_at).getTime() - itemTime) < 10000
      );

      const recipient = users.find(u => u.id === item.user_id);
      const recipientLabel = recipient ? recipient.label : '알 수 없음';

      if (existingGroup) {
        existingGroup.ids.push(item.id);
        existingGroup.user_ids.push(item.user_id);
        existingGroup.recipientLabels.push(recipientLabel);
        if (item.is_read) {
          existingGroup.read_count += 1;
        }
        existingGroup.total_count += 1;
      } else {
        groups.push({
          isGrouped: true,
          id: item.id, // Representative ID
          ids: [item.id],
          user_ids: [item.user_id],
          title: item.title,
          message: item.message,
          type: item.type,
          created_at: item.created_at,
          read_count: item.is_read ? 1 : 0,
          total_count: 1,
          recipientLabels: [recipientLabel],
        });
      }
    });

    // Format recipient label for grouped items
    return groups.map(g => {
      let recipientLabel = '';
      if (g.total_count === 1) {
        recipientLabel = g.recipientLabels[0];
      } else {
        recipientLabel = `${g.recipientLabels[0]} 외 ${g.total_count - 1}명`;
      }
      return {
        ...g,
        recipientLabel
      };
    });
  }, [filteredRows, groupByBroadcast, users]);

  const toggleExpandOption = (surveyId: string, opt: string) => {
    setExpandedOption(prev => ({
      ...prev,
      [surveyId]: prev[surveyId] === opt ? null : opt
    }));
  };

  const fetchAll = async () => {
    setError(null);
    try {
      // 최근순 알림
      const { data: nData, error: nErr } = await supabase
        .from('notifications')
        .select('id, user_id, title, message, type, related_match_id, is_read, created_at, read_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (nErr) throw nErr;

      // 사용자 라벨용 프로필
      const { data: pData, error: pErr } = await supabase
        .from('profiles')
        .select('id, user_id, username, full_name, email, gender');
      if (pErr) throw pErr;
      
      const userOptions = (pData || [])
        .map((p: any) => ({ 
          id: p.user_id || p.id, 
          label: p.full_name || p.username || p.email || (p.user_id || p.id),
          gender: (p.gender || '').toLowerCase()
        }))
        .sort((a: any, b: any) => a.label.localeCompare(b.label, 'ko-KR'));

      // 설문조사 통계 목록 조회
      const sRes = await fetch('/api/admin/surveys');
      const sData = await sRes.json().catch(() => ({ surveys: [] }));

      setRows((nData as any) || []);
      setUsers(userOptions);
      setSurveys(sData.surveys || []);
    } catch (e: any) {
      setError(e?.message || String(e));
      console.error('notifications fetch error', e);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    fetchAll();
  }, [user, isAdmin]);

  const createNotification = async () => {
    if (selectedUserIds.length === 0 || !form.title || !form.message) {
      alert('대상 사용자(최소 1명), 제목, 내용을 입력하세요.');
      return;
    }
    startTransition(async () => {
      try {
        let fileUrl = null;
        let fileName = null;

        if (selectedFile) {
          setUploadingFile(true);
          const fileFormData = new FormData();
          fileFormData.append('file', selectedFile);

          const uploadRes = await fetch('/api/upload-file', {
            method: 'POST',
            body: fileFormData,
          });

          const uploadData = await uploadRes.json().catch(() => null);
          setUploadingFile(false);

          if (!uploadRes.ok || !uploadData?.success) {
            throw new Error(uploadData?.error || '파일 업로드에 실패했습니다.');
          }

          fileUrl = uploadData.publicUrl;
          fileName = uploadData.fileName;
        }

        let targetUserIds = selectedUserIds;

        if (targetUserIds.length === 0) {
          alert('발송 대상자가 없습니다.');
          return;
        }

        let surveyId = null;
        if (form.type === 'survey') {
          if (!surveyTitle.trim()) {
            alert('설문조사 제목(질문)을 입력하세요.');
            return;
          }
          const optList = surveyOptions.map(o => o.trim()).filter(Boolean);
          if (optList.length < 2) {
            alert('설문 선택 항목은 최소 2개 이상 입력해야 합니다.');
            return;
          }

          // Build option limits dictionary
          const optionLimitsObj: Record<string, number> = {};
          surveyOptions.forEach((opt, idx) => {
            const limit = surveyLimits[idx];
            if (opt.trim() && limit !== null && limit !== undefined && limit >= 0) {
              optionLimitsObj[opt.trim()] = limit;
            }
          });

          const surveyRes = await fetch('/api/admin/surveys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              question: surveyTitle.trim(),
              description: form.message.trim(),
              options: optList,
              max_responses: maxResponses === '' ? null : Number(maxResponses),
              option_limits: Object.keys(optionLimitsObj).length > 0 ? optionLimitsObj : null,
            }),
          });
          const surveyData = await surveyRes.json().catch(() => null);
          if (!surveyRes.ok || !surveyData?.survey) {
            throw new Error(surveyData?.error || '설문조사 생성에 실패했습니다.');
          }
          surveyId = surveyData.survey.id;
        }

        const payloads = targetUserIds.map(id => ({
          user_id: id,
          title: form.title,
          message: form.message,
          type: form.type || 'general',
          survey_id: surveyId,
          file_url: fileUrl,
          file_name: fileName,
        }));

        const res = await fetch('/api/admin/notifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payloads }),
        });
        const data = await res.json();
        
        if (!res.ok) {
          throw new Error(data.error || '알림 발송에 실패했습니다.');
        }
        
        alert(`총 ${data.count || targetUserIds.length}명에게 알림이 발송되었습니다.`);
        setForm({ user_id: '', title: '', message: '', type: 'general' });
        setSelectedUserIds([]);
        setSelectedFile(null);
        setSurveyTitle('');
        setSurveyOptions(['참석', '불참', '미정']);
        setSurveyLimits([null, null, null]);
        setMaxResponses('');
        await fetchAll();
      } catch (e: any) {
        alert(`생성 실패: ${e?.message || e}`);
      }
    });
  };

  const markAsRead = async (id: string) => {
    startTransition(async () => {
      const { error: upErr } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id);
      if (upErr) {
        alert(`읽음 처리 실패: ${upErr.message}`);
      } else {
        await fetchAll();
      }
    });
  };

  const remove = async (id: string) => {
    if (!confirm('해당 알림(전체 발송된 경우 모든 회원의 알림)을 삭제하시겠습니까?')) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/notifications?id=${id}`, {
          method: 'DELETE',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || '알림 삭제에 실패했습니다.');
        }
        alert(data.message || '삭제되었습니다.');
        await fetchAll();
      } catch (e: any) {
        alert(`삭제 실패: ${e?.message || e}`);
      }
    });
  };

  const removeSurvey = async (surveyId: string) => {
    if (!confirm('이 설문조사와 관련된 모든 사용자 알림 및 투표 기록이 함께 삭제됩니다. 정말 삭제하시겠습니까?')) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/notifications?survey_id=${surveyId}`, {
          method: 'DELETE',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || '설문조사 삭제에 실패했습니다.');
        }
        alert(data.message || '설문조사가 삭제되었습니다.');
        await fetchAll();
      } catch (e: any) {
        alert(`삭제 실패: ${e?.message || e}`);
      }
    });
  };

  const exportToCSV = (s: any) => {
    let csvContent = '\uFEFF'; // UTF-8 BOM to prevent Korean corruption in Excel/Google Sheets
    
    // Header Info
    csvContent += `설문 질문,"${s.question.replace(/"/g, '""')}"\n`;
    csvContent += `설문 설명,"${(s.description || '').replace(/"/g, '""')}"\n`;
    csvContent += `설문 생성일,${new Date(s.created_at).toLocaleString()}\n`;
    csvContent += `총 응답자,${s.response_count}명\n\n`;
    
    // Summary Stats
    csvContent += `[통계 요약]\n`;
    csvContent += `선택 항목,득표수,비율,제한 인원\n`;
    Object.entries(s.stats || {}).forEach(([opt, count]) => {
      const total = s.response_count || 1;
      const percent = Math.round(((count as number) / total) * 100) || 0;
      const limit = s.option_limits?.[opt] ? `${s.option_limits[opt]}명` : '제한 없음';
      csvContent += `"${opt.replace(/"/g, '""')}",${count}명,${percent}%,${limit}\n`;
    });
    csvContent += `\n`;
    
    // Detailed Voters List
    csvContent += `[응답자 상세 명단]\n`;
    csvContent += `응답자 이름,선택 항목,투표 시간\n`;
    const responses = s.survey_responses || [];
    if (responses.length === 0) {
      csvContent += `응답자가 없습니다.,,\n`;
    } else {
      responses.forEach((r: any) => {
        const u = users.find(user => user.id === r.user_id);
        const name = u ? u.label : '알 수 없는 사용자';
        const voteTime = r.created_at ? new Date(r.created_at).toLocaleString() : '-';
        csvContent += `"${name.replace(/"/g, '""')}","${r.selected_option.replace(/"/g, '""')}",${voteTime}\n`;
      });
    }
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const filename = `설문결과_${s.question.replace(/[/\\?%*:|"<>]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return <div className="p-6">로딩 중...</div>;
  }
  if (!isAdmin) {
    return <div className="p-6 text-red-600">관리자만 접근 가능합니다.</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-3 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
        <div className="relative z-10 flex items-center justify-between px-1">
          <div className="space-y-0.5 pl-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
              <Bell className="h-3.5 w-3.5" />
              공지사항
            </span>
            <h1 className="text-xl font-bold tracking-tight">공지사항/알림 관리</h1>
            <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">사용자에게 보낼 알림을 생성하고, 읽음/삭제를 관리합니다.</p>
          </div>
          <Link href="/manager">
            <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              홈
            </Button>
          </Link>
        </div>
      </section>

      {error && (
        <div className="p-3 rounded border border-red-200 bg-red-50 text-red-700">{error}</div>
      )}

      {/* 생성 폼 */}
      <div className="bg-white rounded border p-4">
        <h2 className="font-semibold mb-3">새 알림 생성</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            className="border rounded px-2 py-2"
            value={form.type}
            onChange={(e) => {
              const newType = e.target.value;
              setForm(prev => ({
                ...prev,
                type: newType
              }));
              if (newType === 'notice') {
                setSelectedUserIds(users.map(u => u.id));
              }
            }}
          >
            {[
              { value: 'general', label: '일반 알림' },
              { value: 'match_preparation', label: '경기 준비' },
              { value: 'match_result', label: '경기 결과' },
              { value: 'schedule_change', label: '일정 변경' },
              { value: 'system', label: '시스템 알림' },
              { value: 'survey', label: '설문조사 알림' },
              { value: 'notice', label: '공지사항' },
            ].map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <div className="relative user-select-dropdown">
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full border rounded px-3 py-2 text-left bg-white text-sm flex items-center justify-between min-h-[38px] cursor-pointer"
            >
              <span className="truncate">
                {selectedUserIds.length === 0
                  ? '대상 사용자 선택'
                  : selectedUserIds.length === users.length
                  ? '전체 회원 선택됨'
                  : `${users.find(u => u.id === selectedUserIds[0])?.label || ''}${
                      selectedUserIds.length > 1 ? ` 외 ${selectedUserIds.length - 1}명` : ''
                    }`}
              </span>
              <span className="text-slate-400 text-xs">▼</span>
            </button>

            {isDropdownOpen && (
              <div className="absolute z-50 mt-1 w-full bg-white border rounded-lg shadow-lg p-3 max-h-60 overflow-y-auto space-y-2">
                <div className="flex flex-wrap gap-1 pb-2 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSelectedUserIds(users.map(u => u.id))}
                    className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded font-semibold"
                  >
                    전체
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const maleIds = users.filter(u => ['m', 'male', 'man', '남', '남성'].includes(u.gender)).map(u => u.id);
                      setSelectedUserIds(maleIds);
                    }}
                    className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 px-2 py-1 rounded font-semibold"
                  >
                    남성 전체
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const femaleIds = users.filter(u => ['f', 'female', 'woman', 'w', '여', '여성'].includes(u.gender)).map(u => u.id);
                      setSelectedUserIds(femaleIds);
                    }}
                    className="text-[10px] bg-rose-50 hover:bg-rose-100 text-rose-700 px-2 py-1 rounded font-semibold"
                  >
                    여성 전체
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedUserIds([])}
                    className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-500 px-2 py-1 rounded font-semibold ml-auto"
                  >
                    해제
                  </button>
                </div>

                <div className="space-y-1.5 pt-1">
                  {users.map((u) => {
                    const isChecked = selectedUserIds.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer hover:bg-slate-50 p-1 rounded">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              setSelectedUserIds(selectedUserIds.filter(id => id !== u.id));
                            } else {
                              setSelectedUserIds([...selectedUserIds, u.id]);
                            }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{u.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <input
            className="border rounded px-2 py-2"
            placeholder="알림 제목"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <button
            onClick={createNotification}
            disabled={isPending || uploadingFile}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded px-3 py-2 disabled:opacity-50"
          >
            {uploadingFile ? '파일 업로드 중...' : '발송하기'}
          </button>
        </div>
        
        {/* 파일 첨부 입력창 */}
        <div className="mt-3 p-3 rounded-lg border border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-500 mb-1">파일 첨부 (5MB 이하, 선택사항)</label>
            <input
              type="file"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                if (file && file.size > 5 * 1024 * 1024) {
                  alert('파일 크기는 5MB를 초과할 수 없습니다.');
                  e.target.value = '';
                  setSelectedFile(null);
                  return;
                }
                setSelectedFile(file);
              }}
              className="block w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </div>
          {selectedFile && (
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              className="text-xs text-rose-600 hover:text-rose-800 font-semibold self-end sm:self-auto"
            >
              첨부 취소
            </button>
          )}
        </div>
        {form.type === 'survey' && (
          <div className="mt-3 p-3 rounded-lg border border-indigo-100 bg-indigo-50/30 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">설문조사 제목 (질문)</label>
                <input
                  className="border rounded px-3 py-2 w-full text-sm bg-white"
                  placeholder="예: 금주 정기모임 참가 여부 투표"
                  value={surveyTitle}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSurveyTitle(val);
                    setForm(prev => ({ ...prev, title: val }));
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">전체 선착순 제한 인원 (선택사항)</label>
                <input
                  type="number"
                  min="1"
                  className="border rounded px-3 py-2 w-full text-sm bg-white"
                  placeholder="예: 20 (비워두면 제한 없음)"
                  value={maxResponses}
                  onChange={(e) => setMaxResponses(e.target.value === '' ? '' : Number(e.target.value))}
                />
              </div>
            </div>
            
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-500 mb-1">설문 선택 항목 및 항목별 제한 (선택사항)</label>
              {surveyOptions.map((opt, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    className="border rounded px-3 py-1.5 flex-[2] text-sm bg-white"
                    placeholder={`항목 ${index + 1}`}
                    value={opt}
                    onChange={(e) => {
                      const updated = [...surveyOptions];
                      updated[index] = e.target.value;
                      setSurveyOptions(updated);
                    }}
                  />
                  <input
                    type="number"
                    min="1"
                    className="border rounded px-2 py-1.5 w-32 text-sm bg-white"
                    placeholder="인원 제한"
                    value={surveyLimits[index] ?? ''}
                    onChange={(e) => {
                      const updated = [...surveyLimits];
                      updated[index] = e.target.value === '' ? null : Number(e.target.value);
                      setSurveyLimits(updated);
                    }}
                  />
                  {surveyOptions.length > 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        const updatedOpts = surveyOptions.filter((_, i) => i !== index);
                        const updatedLimits = surveyLimits.filter((_, i) => i !== index);
                        setSurveyOptions(updatedOpts);
                        setSurveyLimits(updatedLimits);
                      }}
                      className="text-red-500 hover:text-red-700 text-xs px-2 shrink-0"
                    >
                      삭제
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSurveyOptions([...surveyOptions, '']);
                  setSurveyLimits([...surveyLimits, null]);
                }}
                className="mt-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                + 항목 추가
              </button>
            </div>
          </div>
        )}
        <textarea
          className="border rounded px-2 py-2 w-full mt-3"
          placeholder="알림 상세 내용"
          rows={3}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
      </div>

      {/* 목록 */}
      <div className="bg-white rounded border p-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-3">
          <h2 className="font-semibold text-lg">알림 목록</h2>
          <button onClick={fetchAll} className="text-sm px-3 py-2 rounded border hover:bg-slate-50 transition self-end md:self-auto">새로고침</button>
        </div>

        {/* 필터링 및 뷰 설정 바 */}
        <div className="flex flex-col lg:flex-row gap-3 justify-between items-start lg:items-center border-b border-slate-100 pb-4 mb-4">
          {/* 타입 필터 버튼 */}
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: 'general', label: '일반 알림' },
              { value: 'match_preparation', label: '경기 준비' },
              { value: 'match_result', label: '경기 결과' },
              { value: 'schedule_change', label: '일정 변경' },
              { value: 'system', label: '시스템' },
              { value: 'survey', label: '설문조사' },
              { value: 'notice', label: '공지사항' },
            ].map((f) => (
              <button
                key={f.value}
                onClick={() => setFilterType(f.value)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                  filterType === f.value
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* 뷰 모드 및 그룹화 제어 */}
          <div className="flex items-center gap-4 text-xs font-medium text-slate-600 self-end lg:self-auto">
            {/* 그룹화 토글 */}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={groupByBroadcast}
                onChange={(e) => setGroupByBroadcast(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 size-3.5"
              />
              <span>동일 알림 그룹화</span>
            </label>

            {/* 뷰 모드 토글 (모바일 숨김) */}
            <div className="hidden md:flex bg-slate-100 border border-slate-200/60 p-0.5 rounded-lg">
              <button
                onClick={() => setViewMode('card')}
                className={`px-2.5 py-1 rounded-md transition ${
                  viewMode === 'card'
                    ? 'bg-white text-slate-900 shadow-sm font-bold'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                🎴 카드
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-2.5 py-1 rounded-md transition ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-sm font-bold'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                📋 표
              </button>
            </div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="text-gray-500 text-sm py-8 text-center bg-slate-50 rounded-xl border border-dashed">등록된 알림이 없습니다.</div>
        ) : displayRows.length === 0 ? (
          <div className="text-gray-500 text-sm py-8 text-center bg-slate-50 rounded-xl border border-dashed">
            {filterType === 'all' ? '알림 타입을 선택하시면 해당 내역이 표시됩니다.' : '조건에 맞는 알림 내역이 없습니다.'}
          </div>
        ) : viewMode === 'card' ? (
          /* 카드 보기 (5열 구성) */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
            {displayRows.map((n) => {
              let typeLabel = n.type;
              switch(n.type) {
                case 'general': typeLabel = '일반 알림'; break;
                case 'match_preparation': typeLabel = '경기 준비'; break;
                case 'match_result': typeLabel = '경기 결과'; break;
                case 'schedule_change': typeLabel = '일정 변경'; break;
                case 'system': typeLabel = '시스템 알림'; break;
                case 'survey': typeLabel = '설문조사'; break;
                case 'notice': typeLabel = '공지사항'; break;
              }

              let readStatusNode = null;
              if (n.total_count > 1) {
                const percent = Math.round((n.read_count / n.total_count) * 100) || 0;
                readStatusNode = (
                  <div className="w-full space-y-1">
                    <div className="flex justify-between items-center text-[10px] text-slate-500">
                      <span>읽음 현황 ({n.read_count}/{n.total_count}명)</span>
                      <span className="font-bold text-indigo-600">{percent}%</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                      <div className="bg-indigo-600 h-full rounded-full transition-all duration-300" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              } else {
                readStatusNode = !n.is_read ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-semibold">안읽음</span>
                    <button onClick={() => markAsRead(n.id)} className="text-[11px] font-semibold px-2 py-1 rounded bg-green-50 hover:bg-green-100 text-green-700 transition">읽음</button>
                  </div>
                ) : (
                  <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md font-semibold">읽음</span>
                );
              }

              return (
              <div key={n.id} className="border rounded-xl p-4 bg-slate-50/55 flex flex-col justify-between hover:shadow-md transition duration-200">
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md inline-block mb-1.5">{typeLabel}</div>
                      <div className="font-bold text-slate-800 text-xs sm:text-sm line-clamp-1" title={n.title}>{n.title}</div>
                    </div>
                    <div className="text-[9px] text-slate-400 shrink-0">{new Date(n.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="mt-2.5 text-xs text-slate-600 whitespace-pre-line leading-relaxed line-clamp-4" title={n.message}>{n.message}</div>
                  {n.file_url && (
                    <div className="mt-2.5 p-2 rounded bg-slate-100 border border-slate-200/50 flex items-center justify-between">
                      <span className="text-[11px] text-slate-700 truncate font-medium">📎 {n.file_name || '첨부파일'}</span>
                      <a
                        href={n.file_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-2 py-1 rounded shrink-0 transition"
                      >
                        다운로드
                      </a>
                    </div>
                  )}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2 text-xs">
                  <div className="text-slate-500 truncate" title={n.recipientLabels?.join(', ') || n.recipientLabel}>
                    <span className="font-semibold text-slate-400">수신자:</span> {n.recipientLabel}
                  </div>
                  <div className="flex items-center justify-between min-h-[28px]">
                    {readStatusNode}
                    <button onClick={() => remove(n.id)} className="text-[11px] font-semibold px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 transition shrink-0 ml-auto">삭제</button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        ) : (
          /* 테이블 보기 */
          <div className="overflow-x-auto border rounded-xl bg-slate-50/30">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider">
                  <th className="p-3">유형</th>
                  <th className="p-3">제목</th>
                  <th className="p-3">내용</th>
                  <th className="p-3">수신 대상</th>
                  <th className="p-3">읽음 현황</th>
                  <th className="p-3">발송 일시</th>
                  <th className="p-3 text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {displayRows.map((n) => {
                  let typeLabel = n.type;
                  switch(n.type) {
                    case 'general': typeLabel = '일반 알림'; break;
                    case 'match_preparation': typeLabel = '경기 준비'; break;
                    case 'match_result': typeLabel = '경기 결과'; break;
                    case 'schedule_change': typeLabel = '일정 변경'; break;
                    case 'system': typeLabel = '시스템 알림'; break;
                    case 'survey': typeLabel = '설문조사'; break;
                    case 'notice': typeLabel = '공지사항'; break;
                  }

                  let readStatusNode = null;
                  if (n.total_count > 1) {
                    const percent = Math.round((n.read_count / n.total_count) * 100) || 0;
                    readStatusNode = (
                      <div className="space-y-1">
                        <div className="font-semibold text-slate-700">{n.read_count}/{n.total_count} 명 ({percent}%)</div>
                        <div className="w-20 bg-gray-200 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-indigo-600 h-full rounded-full" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    );
                  } else {
                    readStatusNode = n.is_read ? (
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-semibold">읽음</span>
                    ) : (
                      <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-semibold">안읽음</span>
                    );
                  }

                  return (
                    <tr key={n.id} className="hover:bg-slate-50/50 transition">
                      <td className="p-3 whitespace-nowrap">
                        <span className="px-2.5 py-0.5 rounded-md font-semibold text-[10px] bg-indigo-50 text-indigo-700">
                          {typeLabel}
                        </span>
                      </td>
                      <td className="p-3 font-semibold text-slate-800 max-w-[150px] truncate" title={n.title}>
                        {n.title}
                      </td>
                      <td className="p-3 text-slate-500 max-w-[200px]" title={n.message}>
                        <div className="truncate">{n.message}</div>
                        {n.file_url && (
                          <div className="mt-1">
                            <a
                              href={n.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-indigo-600 hover:underline font-semibold"
                            >
                              📎 {n.file_name || '첨부파일'}
                            </a>
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-slate-600 max-w-[150px] truncate" title={n.recipientLabels?.join(', ') || n.recipientLabel}>
                        {n.recipientLabel}
                      </td>
                      <td className="p-3 whitespace-nowrap">
                        {readStatusNode}
                      </td>
                      <td className="p-3 text-slate-400 whitespace-nowrap">
                        {new Date(n.created_at).toLocaleString()}
                      </td>
                      <td className="p-3 text-right space-x-1.5 whitespace-nowrap">
                        {!n.is_read && n.total_count === 1 && (
                          <button onClick={() => markAsRead(n.id)} className="text-[11px] font-semibold px-2 py-1 rounded bg-green-50 hover:bg-green-100 text-green-700 transition">
                            읽음
                          </button>
                        )}
                        <button onClick={() => remove(n.id)} className="text-[11px] font-semibold px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 transition">
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 설문조사 결과 목록 */}
      <div className="bg-white rounded border p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">설문조사 통계 및 결과</h2>
          <button onClick={fetchAll} className="text-sm px-3 py-2 rounded border">새로고침</button>
        </div>
        {surveys.length === 0 ? (
          <div className="text-gray-500 text-sm">등록된 설문조사가 없습니다.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {surveys.map((s) => (
              <div key={s.id} className="border rounded-xl p-4 bg-slate-50">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-700'}`}>
                      {s.is_active ? '진행중' : '종료됨'}
                    </span>
                    <h3 className="font-bold text-slate-800 text-base mt-1">{s.question}</h3>
                  </div>
                  <span className="text-xs text-gray-500">{new Date(s.created_at).toLocaleDateString()}</span>
                </div>
                {s.description && (
                  <p className="text-xs text-gray-600 mb-2 whitespace-pre-line">{s.description}</p>
                )}

                {/* 액션 버튼: 내보내기 & 삭제 */}
                <div className="flex items-center gap-2 mb-4">
                  <button
                    onClick={() => exportToCSV(s)}
                    className="text-[11px] font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded transition flex items-center gap-1"
                  >
                    📥 내보내기
                  </button>
                  <button
                    onClick={() => removeSurvey(s.id)}
                    className="text-[11px] font-semibold bg-red-50 hover:bg-red-100 text-red-700 px-2.5 py-1 rounded transition"
                  >
                    삭제
                  </button>
                </div>
                
                {/* 통계 바 차트 형태 */}
                <div className="space-y-3">
                  {Object.entries(s.stats || {}).map(([opt, count], idx) => {
                    const total = s.response_count || 1;
                    const percent = Math.round(((count as number) / total) * 100) || 0;
                    const isExpanded = expandedOption[s.id] === opt;
                    
                    // 다양한 색상 순환
                    const colors = ['bg-indigo-600', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];
                    const barColor = colors[idx % colors.length];

                    // 이 옵션을 선택한 사용자 필터링
                    const respondents = (s.survey_responses || [])
                      .filter((r: any) => r.selected_option === opt)
                      .map((r: any) => {
                        const u = users.find(user => user.id === r.user_id);
                        return u ? u.label : '알 수 없는 사용자';
                      });

                    return (
                      <div key={opt} className="space-y-1 p-2 rounded-lg hover:bg-slate-100/50 transition">
                        <div 
                          className="flex justify-between items-center text-xs font-semibold text-gray-700 cursor-pointer"
                          onClick={() => toggleExpandOption(s.id, opt)}
                        >
                          <span className="flex items-center gap-1 hover:text-indigo-600 transition">
                            {opt}
                            {s.option_limits?.[opt] !== undefined && s.option_limits?.[opt] !== null && (
                              <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1 py-0.2 rounded">
                                (제한: {s.option_limits[opt]}명)
                              </span>
                            )}
                            <span className="text-[10px] text-slate-400 font-normal">(명단 보기 {isExpanded ? '▲' : '▼'})</span>
                          </span>
                          <span className="font-bold">{count as number}명 ({percent}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`${barColor} h-full rounded-full transition-all duration-500`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>

                        {/* 명단 표시 */}
                        {isExpanded && (
                          <div className="mt-2 pl-2 border-l-2 border-slate-300">
                            {respondents.length > 0 ? (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {respondents.map((name: string, i: number) => (
                                  <span key={i} className="text-[10px] bg-white border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded shadow-sm">
                                    {name}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400">응답한 사용자가 없습니다.</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t border-slate-200 flex justify-between items-center text-xs font-semibold text-slate-500">
                  <span className="flex items-center gap-2">
                    <span>총 응답자: {s.response_count}명</span>
                    {s.max_responses !== null && s.max_responses !== undefined && (
                      <span className="text-[11px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded">
                        (전체 정원 제한: {s.max_responses}명)
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] text-slate-400 font-normal">* 각 항목명을 누르면 상세 투표자 명단을 확인할 수 있습니다.</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/hooks/useUser';
import { useClub } from '@/hooks/useClub';
import { Button } from '@/components/ui/button';
import type { Json } from '@/types/supabase';
import { formatKSTDateTime } from '@/lib/date';

interface RecurringTemplate {
  id: string | null;
  name: string | null;
  description: string | null;
  day_of_week: number | null;
  day_name: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  max_participants: number | null;
  is_active: boolean | null;
  advance_days: number | null;
  created_at: string | null;
}

type GenerationResult = {
  created_matches: number;
  message: string;
  execution_time: string;
};

const DAYS_OPTIONS = [
  { value: 0, label: '일요일' },
  { value: 1, label: '월요일' },
  { value: 2, label: '화요일' },
  { value: 3, label: '수요일' },
  { value: 4, label: '목요일' },
  { value: 5, label: '금요일' },
  { value: 6, label: '토요일' },
];

function parseNumberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function RecurringMatchPage() {
  const { user } = useUser();
  const { clubId, loading: clubLoading } = useClub();
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RecurringTemplate | null>(null);
  const [generationResult, setGenerationResult] = useState<GenerationResult | null>(null);
  const parseGenerationResult = (value: Json | null): GenerationResult | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return {
      created_matches: typeof value.created_matches === 'number' ? value.created_matches : 0,
      message: typeof value.message === 'string' ? value.message : '정기모임 생성이 완료되었습니다.',
      execution_time: typeof value.execution_time === 'string' ? value.execution_time : new Date().toISOString(),
    };
  };

  // 새 템플릿 폼 데이터
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    description: '',
    day_of_weeks: [6],
    start_time: '14:00',
    end_time: '17:00',
    location: '',
    max_participants: 20 as number | null,
    advance_days: 7 as number | null
  });

  // 템플릿 목록 조회
  const fetchTemplates = async () => {
    if (!clubId) return;
    try {
      setLoading(true);

      const response = await fetch(`/api/admin/recurring-templates?club_id=${clubId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch templates');
      }

      const result = await response.json();
      const templatesData = result.templates || [];

      const DAYS_MAP = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
      const resolved = templatesData.map((t: any) => ({
        ...t,
        day_name: t.day_of_week !== null && t.day_of_week !== undefined ? DAYS_MAP[t.day_of_week] : null
      }));

      setTemplates(resolved as RecurringTemplate[]);
    } catch (error) {
      console.error('정기모임 템플릿 조회 중 오류:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!clubLoading && clubId) {
      fetchTemplates();
    }
  }, [clubId, clubLoading]);

  // 새 템플릿 생성
  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) return;
    if (newTemplate.day_of_weeks.length === 0) {
      alert('요일을 하나 이상 선택해주세요.');
      return;
    }

    try {
      const rowsCount = newTemplate.day_of_weeks.length;
      const response = await fetch('/api/admin/recurring-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...newTemplate, club_id: clubId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error('템플릿 생성 오류:', payload);
        alert('템플릿 생성 중 오류가 발생했습니다.');
        return;
      }

      // 폼 초기화
      setNewTemplate({
        name: '',
        description: '',
        day_of_weeks: [6],
        start_time: '14:00',
        end_time: '17:00',
        location: '',
        max_participants: 20,
        advance_days: 7
      });
      setShowCreateForm(false);

      // 목록 새로고침
      await fetchTemplates();
      alert(`${rowsCount}개의 정기모임 템플릿이 생성되었습니다!`);

    } catch (error) {
      console.error('템플릿 생성 중 오류:', error);
      alert('템플릿 생성 중 오류가 발생했습니다.');
    }
  };

  const toggleNewTemplateDay = (dayValue: number) => {
    setNewTemplate((current) => {
      const exists = current.day_of_weeks.includes(dayValue);
      const nextDays = exists
        ? current.day_of_weeks.filter((value) => value !== dayValue)
        : [...current.day_of_weeks, dayValue].sort((a, b) => a - b);

      return {
        ...current,
        day_of_weeks: nextDays,
      };
    });
  };

  // 템플릿 수정
  const handleUpdateTemplate = async (template: RecurringTemplate) => {
    if (!template.id) {
      alert('수정할 템플릿 ID를 찾을 수 없습니다.');
      return;
    }

    try {
      const response = await fetch('/api/admin/recurring-templates', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: template.id,
          name: template.name,
          description: template.description,
          day_of_week: template.day_of_week,
          start_time: template.start_time,
          end_time: template.end_time,
          location: template.location,
          max_participants: template.max_participants,
          advance_days: template.advance_days,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error('템플릿 수정 오류:', payload);
        alert('템플릿 수정 중 오류가 발생했습니다.');
        return;
      }

      setEditingTemplate(null);
      await fetchTemplates();
      alert('템플릿이 수정되었습니다!');

    } catch (error) {
      console.error('템플릿 수정 중 오류:', error);
      alert('템플릿 수정 중 오류가 발생했습니다.');
    }
  };

  // 템플릿 활성화/비활성화
  const handleToggleActive = async (id: string, currentActive: boolean) => {
    try {
      const response = await fetch('/api/admin/recurring-templates', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id,
          is_active: !currentActive,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error('템플릿 활성화 변경 오류:', payload);
        alert('템플릿 활성화 변경 중 오류가 발생했습니다.');
        return;
      }

      await fetchTemplates();
      alert(`템플릿이 ${!currentActive ? '활성화' : '비활성화'}되었습니다.`);

    } catch (error) {
      console.error('템플릿 활성화 변경 중 오류:', error);
    }
  };

  // 템플릿 삭제
  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(`'${name}' 템플릿을 삭제하시겠습니까?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/recurring-templates?id=${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error('템플릿 삭제 오류:', payload);
        alert('템플릿 삭제 중 오류가 발생했습니다.');
        return;
      }

      setSelectedTemplateIds((current) => current.filter((templateId) => templateId !== id));
      await fetchTemplates();
      alert('템플릿이 삭제되었습니다.');

    } catch (error) {
      console.error('템플릿 삭제 중 오류:', error);
      alert('템플릿 삭제 중 오류가 발생했습니다.');
    }
  };

  // 수동으로 정기모임 생성 실행
  const handleGenerateMatches = async (templateIds?: string[]) => {
    try {
      const idsToGenerate = templateIds?.filter(Boolean) ?? [];
      const response = await fetch('/api/cron/recurring-matches', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          idsToGenerate.length > 0
            ? { template_ids: idsToGenerate }
            : {}
        ),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error('정기모임 생성 오류:', payload);
        alert('정기모임 생성 중 오류가 발생했습니다.');
        return;
      }

      const payload = await response.json();
      const result = parseGenerationResult((payload?.result ?? payload) as Json | null);
      setGenerationResult(result);
      if (idsToGenerate.length > 0) {
        setSelectedTemplateIds([]);
      }
      alert(`성공! ${result?.created_matches || 0}개의 새로운 정기모임이 생성되었습니다.`);

    } catch (error) {
      console.error('정기모임 생성 중 오류:', error);
      alert('정기모임 생성 중 오류가 발생했습니다.');
    }
  };

  const toggleTemplateSelection = (templateId: string) => {
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId]
    );
  };

  const selectableTemplates = templates.filter((template) => Boolean(template.id));
  const allSelectableTemplateIds = selectableTemplates
    .map((template) => template.id)
    .filter((templateId): templateId is string => Boolean(templateId));
  const isAllSelected =
    allSelectableTemplateIds.length > 0 &&
    allSelectableTemplateIds.every((templateId) => selectedTemplateIds.includes(templateId));

  const toggleSelectAllTemplates = () => {
    setSelectedTemplateIds(isAllSelected ? [] : allSelectableTemplateIds);
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="text-lg">정기모임 템플릿을 불러오는 중...</div>
      </div>
    );
  }

  return (
      <div className="w-full p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-4">🔄 정기모임 자동 생성 관리</h1>
          <p className="text-gray-600 mb-6">
            정기적으로 반복되는 배드민턴 모임을 자동으로 생성하도록 설정할 수 있습니다.
          </p>
          
          <div className="flex gap-4 mb-6">
            <Button 
              onClick={() => setShowCreateForm(true)}
              className="bg-blue-500 hover:bg-blue-600"
            >
              새 정기모임 템플릿 추가
            </Button>

            <Button
              onClick={() => handleGenerateMatches(selectedTemplateIds)}
              variant="outline"
              className="border-emerald-500 text-emerald-600 hover:bg-emerald-50"
              disabled={selectedTemplateIds.length === 0}
            >
              선택된 정기모임 생성 실행
            </Button>
          </div>
          <p className="mb-6 text-sm text-gray-500">
            선택 실행은 각 템플릿에 설정된 미리 생성할 일 수(Advance Days) 범위 내의 모든 일정을 생성합니다.
          </p>

          {generationResult && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="font-semibold text-green-800 mb-2">생성 결과</h3>
              <p className="text-green-700">{generationResult.message}</p>
              <p className="text-sm text-green-600 mt-1">
                실행 시간: {formatKSTDateTime(generationResult.execution_time)}
              </p>
            </div>
          )}
        </div>

        {/* 새 템플릿 생성 폼 */}
        {showCreateForm && (
          <div className="mb-8 p-6 border border-gray-300 rounded-lg bg-gray-50">
            <h2 className="text-xl font-semibold mb-4">새 정기모임 템플릿 생성</h2>
            <form onSubmit={handleCreateTemplate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">모임 이름</label>
                  <input
                    type="text"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({...newTemplate, name: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium mb-2">요일</label>
                  <div className="grid grid-cols-2 gap-2 rounded border border-gray-300 p-3 md:grid-cols-3">
                    {DAYS_OPTIONS.map((day) => {
                      const checked = newTemplate.day_of_weeks.includes(day.value);

                      return (
                        <label
                          key={day.value}
                          className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm transition-colors ${
                            checked ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-100'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleNewTemplateDay(day.value)}
                            className="h-4 w-4"
                          />
                          <span>{day.label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">여러 요일을 선택하면 동일한 조건으로 템플릿이 각각 생성됩니다.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">시작 시간</label>
                  <input
                    type="time"
                    value={newTemplate.start_time}
                    onChange={(e) => setNewTemplate({...newTemplate, start_time: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">종료 시간</label>
                  <input
                    type="time"
                    value={newTemplate.end_time}
                    onChange={(e) => setNewTemplate({...newTemplate, end_time: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">장소</label>
                  <input
                    type="text"
                    value={newTemplate.location}
                    onChange={(e) => setNewTemplate({...newTemplate, location: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">최대 참가자</label>
                  <input
                    type="number"
                    value={newTemplate.max_participants ?? ''}
                    onChange={(e) => setNewTemplate({...newTemplate, max_participants: parseNumberOrNull(e.target.value)})}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="4"
                    max="50"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">미리 생성할 일수</label>
                  <input
                    type="number"
                    value={newTemplate.advance_days ?? ''}
                    onChange={(e) => setNewTemplate({...newTemplate, advance_days: parseNumberOrNull(e.target.value)})}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="1"
                    max="30"
                    required
                  />
                  <p className="text-sm text-gray-500 mt-1">몇 일 전에 미리 일정을 생성할지 설정</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">설명</label>
                <textarea
                  value={newTemplate.description}
                  onChange={(e) => setNewTemplate({...newTemplate, description: e.target.value})}
                  className="w-full p-2 border border-gray-300 rounded"
                  rows={3}
                />
              </div>

              <div className="flex gap-2">
                <Button type="submit" className="bg-green-500 hover:bg-green-600">
                  템플릿 생성
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setShowCreateForm(false)}
                >
                  취소
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* 템플릿 목록 */}
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold">정기모임 템플릿 목록</h2>
          </div>

          {templates.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              등록된 정기모임 템플릿이 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={toggleSelectAllTemplates}
                          className="h-4 w-4"
                        />
                        <span>선택</span>
                      </label>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      모임명
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      요일
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      시간
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      장소
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      최대 참가자
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      상태
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      관리
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {templates.map((template) => (
                    <tr key={template.id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {template.id ? (
                          <input
                            type="checkbox"
                            checked={selectedTemplateIds.includes(template.id)}
                            onChange={() => toggleTemplateSelection(template.id || '')}
                            className="h-4 w-4"
                          />
                        ) : null}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {template.name}
                          </div>
                          {template.description && (
                            <div className="text-sm text-gray-500">
                              {template.description}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {template.day_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {template.start_time} - {template.end_time}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {template.location}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {template.max_participants}명
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          template.is_active 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          {template.is_active ? '활성' : '비활성'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingTemplate(template)}
                        >
                          수정
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleToggleActive(template.id || '', Boolean(template.is_active))}
                          className={template.is_active ? 'text-red-600' : 'text-green-600'}
                        >
                          {template.is_active ? '비활성화' : '활성화'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteTemplate(template.id || '', template.name || '이름 없는 템플릿')}
                          className="text-red-600 hover:text-red-700"
                        >
                          삭제
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 수정 모달 */}
        {editingTemplate && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-semibold mb-4">템플릿 수정</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">모임 이름</label>
                  <input
                    type="text"
                    value={editingTemplate.name || ''}
                    onChange={(e) => setEditingTemplate({...editingTemplate, name: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">요일</label>
                  <select
                    value={editingTemplate.day_of_week ?? 0}
                      onChange={(e) => setEditingTemplate({...editingTemplate, day_of_week: parseNumberOrNull(e.target.value)})}
                    className="w-full p-2 border border-gray-300 rounded"
                  >
                    {DAYS_OPTIONS.map(day => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-2">시작 시간</label>
                    <input
                      type="time"
                      value={editingTemplate.start_time || ''}
                      onChange={(e) => setEditingTemplate({...editingTemplate, start_time: e.target.value})}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">종료 시간</label>
                    <input
                      type="time"
                      value={editingTemplate.end_time || ''}
                      onChange={(e) => setEditingTemplate({...editingTemplate, end_time: e.target.value})}
                      className="w-full p-2 border border-gray-300 rounded"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">장소</label>
                  <input
                    type="text"
                    value={editingTemplate.location || ''}
                    onChange={(e) => setEditingTemplate({...editingTemplate, location: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">최대 참가자</label>
                  <input
                    type="number"
                      value={editingTemplate.max_participants ?? ''}
                      onChange={(e) => setEditingTemplate({...editingTemplate, max_participants: parseNumberOrNull(e.target.value)})}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="4"
                    max="50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">미리 생성할 일수</label>
                  <input
                    type="number"
                      value={editingTemplate.advance_days ?? ''}
                      onChange={(e) => setEditingTemplate({...editingTemplate, advance_days: parseNumberOrNull(e.target.value)})}
                    className="w-full p-2 border border-gray-300 rounded"
                    min="1"
                    max="30"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">설명</label>
                  <textarea
                    value={editingTemplate.description || ''}
                    onChange={(e) => setEditingTemplate({...editingTemplate, description: e.target.value})}
                    className="w-full p-2 border border-gray-300 rounded"
                    rows={3}
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-6">
                <Button 
                  onClick={() => handleUpdateTemplate(editingTemplate)}
                  className="bg-blue-500 hover:bg-blue-600"
                >
                  수정
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => setEditingTemplate(null)}
                >
                  취소
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
  );
}

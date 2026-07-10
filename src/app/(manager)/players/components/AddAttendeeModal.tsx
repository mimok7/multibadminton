'use client';

import { useState, useEffect } from 'react';
import { getKoreaDate } from '@/lib/date';
import { fetchRegisteredPlayersForDate } from '../utils';

interface AddAttendeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (userIds: string[]) => Promise<void>;
  existingUserIds: Set<string>;
}

export default function AddAttendeeModal({
  isOpen,
  onClose,
  onAdd,
  existingUserIds
}: AddAttendeeModalProps) {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [registeredIds, setRegisteredIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyRegistered, setShowOnlyRegistered] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setSelectedIds(new Set());
      setSearchQuery('');
      setShowOnlyRegistered(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      try {
        const today = getKoreaDate();
        
        // 1. Fetch all club members
        const res = await fetch('/api/admin/match-schedules?profiles_all=1&profiles_query=', {
          cache: 'no-store'
        });
        const profilesData = res.ok ? await res.json() : { profiles: [] };
        
        // 2. Fetch today's registered players
        const registeredPlayers = await fetchRegisteredPlayersForDate(today);
        const regIds = new Set(registeredPlayers.map(p => p.id));
        
        setProfiles(profilesData.profiles || []);
        setRegisteredIds(regIds);
        
        // If there are registered players, default to showing only them
        if (regIds.size > 0) {
          setShowOnlyRegistered(true);
        }
      } catch (error) {
        console.error('회원 목록 조회 오류:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [isOpen]);

  if (!isOpen) return null;

  const getProfileKey = (profile: any) => profile?.id || profile?.user_id || '';

  const filteredProfiles = profiles
    .filter(p => {
      const profileKey = getProfileKey(p);
      return profileKey ? !existingUserIds.has(profileKey) : false;
    })
    .filter(p => {
      const profileKey = getProfileKey(p);
      if (showOnlyRegistered && !registeredIds.has(profileKey)) return false;
      
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (p.full_name?.toLowerCase().includes(q) || p.username?.toLowerCase().includes(q));
    });

  // Sort: Registered first, then alphabetically
  const sortedProfiles = [...filteredProfiles].sort((a, b) => {
    const aReg = registeredIds.has(getProfileKey(a)) ? -1 : 1;
    const bReg = registeredIds.has(getProfileKey(b)) ? -1 : 1;
    if (aReg !== bReg) return aReg - bReg;
    
    const aName = a.full_name || a.username || '';
    const bName = b.full_name || b.username || '';
    return aName.localeCompare(bName, 'ko-KR');
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  
  const handleSelectAll = () => {
    const allFilteredIds = sortedProfiles.map((p) => getProfileKey(p)).filter(Boolean);
    // If all are currently selected, deselect all. Otherwise, select all.
    const allSelected = allFilteredIds.every(id => selectedIds.has(id));
    
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allFilteredIds));
    }
  };

  const handleAdd = async () => {
    if (selectedIds.size === 0) return;
    await onAdd(Array.from(selectedIds));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="border-b px-6 py-4 flex justify-between items-center bg-gray-50">
          <h3 className="text-lg font-bold text-gray-900">출석자 수동 추가</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-900 font-bold text-xl">&times;</button>
        </div>
        
        <div className="px-6 py-4 border-b flex flex-col sm:flex-row gap-3 justify-between items-center bg-white">
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowOnlyRegistered(true)}
              className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
                showOnlyRegistered ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } border`}
            >
              오늘 참가신청 회원 ({profiles.filter(p => {
                const profileKey = getProfileKey(p);
                return profileKey && registeredIds.has(profileKey) && !existingUserIds.has(profileKey);
              }).length})
            </button>
            <button
              onClick={() => setShowOnlyRegistered(false)}
              className={`px-3 py-1.5 text-sm rounded-full font-medium transition-colors ${
                !showOnlyRegistered ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              } border`}
            >
              전체 클럽 회원
            </button>
          </div>
          
          <div className="flex w-full sm:w-auto gap-2">
            <input
              type="text"
              placeholder="이름으로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 sm:w-48 px-3 py-1.5 text-sm border rounded-md"
            />
            <button
              onClick={handleSelectAll}
              disabled={sortedProfiles.length === 0}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded border hover:bg-gray-200 whitespace-nowrap"
            >
              전체 선택
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 bg-gray-50">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500"></div>
            </div>
          ) : sortedProfiles.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {showOnlyRegistered 
                ? '오늘 참가신청한 회원 중 추가할 수 있는 회원이 없습니다.' 
                : '조건에 맞는 회원이 없습니다.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {sortedProfiles.map(p => {
                const profileKey = getProfileKey(p);
                const isSelected = selectedIds.has(profileKey);
                const isReg = registeredIds.has(profileKey);
                
                return (
                  <div
                    key={profileKey}
                    onClick={() => toggleSelect(profileKey)}
                    className={`flex flex-col cursor-pointer justify-center gap-1 rounded-lg border p-3 transition-colors ${
                      isSelected 
                        ? 'border-blue-500 bg-blue-50' 
                        : isReg ? 'border-amber-200 bg-amber-50 hover:border-amber-300' : 'border-gray-200 bg-white hover:border-blue-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-medium text-gray-800">{p.full_name || p.username || '이름 없음'}</span>
                    </div>
                    {isReg && !isSelected && (
                      <span className="text-[10px] text-amber-600 font-bold ml-6 bg-amber-100 w-max px-1.5 py-0.5 rounded">참가신청</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t px-6 py-4 bg-white flex justify-end gap-3 items-center">
          <div className="text-sm text-gray-600 mr-auto">
            {selectedIds.size}명 선택됨
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded-md hover:bg-gray-50"
          >
            취소
          </button>
          <button
            onClick={handleAdd}
            disabled={selectedIds.size === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {selectedIds.size}명 출석 추가
          </button>
        </div>
      </div>
    </div>
  );
}

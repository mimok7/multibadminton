'use client';

import { useState } from 'react';
import { ExtendedPlayer } from '../types';
import { Match } from '@/types';

interface ManualMatchAssignmentProps {
  presentPlayers: ExtendedPlayer[];
  isOpen: boolean;
  onClose: () => void;
  onCreateMatches: (matches: Match[]) => void;
}

export default function ManualMatchAssignment({ 
  presentPlayers, 
  isOpen,
  onClose,
  onCreateMatches
}: ManualMatchAssignmentProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [team1Player1, setTeam1Player1] = useState<string>('');
  const [team1Player2, setTeam1Player2] = useState<string>('');
  const [team2Player1, setTeam2Player1] = useState<string>('');
  const [team2Player2, setTeam2Player2] = useState<string>('');

  if (!isOpen) return null;

  const handleAddMatch = () => {
    // 검증: 4명 모두 선택되었는지
    if (!team1Player1 || !team1Player2 || !team2Player1 || !team2Player2) {
      alert('4명의 선수를 모두 선택해주세요.');
      return;
    }

    // 검증: 중복 선수가 없는지
    const selectedIds = [team1Player1, team1Player2, team2Player1, team2Player2];
    const uniqueIds = new Set(selectedIds);
    if (uniqueIds.size !== 4) {
      alert('중복된 선수가 있습니다. 각 선수는 한 번씩만 선택해야 합니다.');
      return;
    }

    // 선수 정보 조회
    const getPlayer = (id: string) => presentPlayers.find(p => p.id === id);
    
    const p1 = getPlayer(team1Player1);
    const p2 = getPlayer(team1Player2);
    const p3 = getPlayer(team2Player1);
    const p4 = getPlayer(team2Player2);

    if (!p1 || !p2 || !p3 || !p4) {
      alert('선수 정보를 찾을 수 없습니다.');
      return;
    }

    // 경기 생성
    const newMatch: Match = {
      id: `manual-match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      team1: {
        player1: p1,
        player2: p2
      },
      team2: {
        player1: p3,
        player2: p4
      }
    };

    setMatches(prev => [...prev, newMatch]);

    // 폼 초기화
    setTeam1Player1('');
    setTeam1Player2('');
    setTeam2Player1('');
    setTeam2Player2('');
  };

  const handleReset = () => {
    setTeam1Player1('');
    setTeam1Player2('');
    setTeam2Player1('');
    setTeam2Player2('');
  };

  const handleRemoveMatch = (matchId: string) => {
    setMatches(prev => prev.filter(m => m.id !== matchId));
  };

  const handleComplete = () => {
    if (matches.length === 0) {
      alert('최소 1개의 경기를 생성해주세요.');
      return;
    }
    onCreateMatches(matches);
    // 초기화
    setMatches([]);
    setTeam1Player1('');
    setTeam1Player2('');
    setTeam2Player1('');
    setTeam2Player2('');
    onClose();
  };

  const handleCancel = () => {
    if (matches.length > 0) {
      if (!confirm(`생성된 ${matches.length}개의 경기가 삭제됩니다. 계속하시겠습니까?`)) {
        return;
      }
    }
    setMatches([]);
    setTeam1Player1('');
    setTeam1Player2('');
    setTeam2Player1('');
    setTeam2Player2('');
    onClose();
  };

  // 이미 선택된 선수들
  const selectedIds = [team1Player1, team1Player2, team2Player1, team2Player2].filter(Boolean);

  // 선수 선택 셀렉트 박스 렌더링
  const renderPlayerSelect = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    excludeIds: string[] = []
  ) => {
    const availablePlayers = presentPlayers.filter(p => !excludeIds.includes(p.id) || p.id === value);
    
    return (
      <div className="flex-1">
        <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">선수 선택</option>
          {availablePlayers.map(player => (
            <option key={player.id} value={player.id}>
              {player.name} ({player.skill_label}) {player.gender === 'male' || player.gender === 'm' ? '♂' : player.gender === 'female' || player.gender === 'f' ? '♀' : ''}
            </option>
          ))}
        </select>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold">✋ 수동 경기 배정</h2>
          <button
            onClick={handleCancel}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {presentPlayers.length < 4 ? (
            <div className="text-gray-600 text-center py-8">
              등록된 참가 선수가 4명 이상이어야 수동 배정이 가능합니다. (현재: {presentPlayers.length}명)
            </div>
          ) : (
            <>
              {/* 경기 생성 폼 */}
              <div className="space-y-4 p-4 border border-blue-300 rounded bg-blue-50">
                <h3 className="font-semibold text-lg">새 경기 추가</h3>
                
                {/* 팀 1 */}
                <div className="bg-white p-3 rounded border border-gray-200">
                  <h4 className="text-md font-semibold mb-2 text-blue-600">팀 1</h4>
                  <div className="flex gap-3">
                    {renderPlayerSelect('선수 1', team1Player1, setTeam1Player1, selectedIds.filter(id => id !== team1Player1))}
                    {renderPlayerSelect('선수 2', team1Player2, setTeam1Player2, selectedIds.filter(id => id !== team1Player2))}
                  </div>
                </div>

                {/* 팀 2 */}
                <div className="bg-white p-3 rounded border border-gray-200">
                  <h4 className="text-md font-semibold mb-2 text-red-600">팀 2</h4>
                  <div className="flex gap-3">
                    {renderPlayerSelect('선수 1', team2Player1, setTeam2Player1, selectedIds.filter(id => id !== team2Player1))}
                    {renderPlayerSelect('선수 2', team2Player2, setTeam2Player2, selectedIds.filter(id => id !== team2Player2))}
                  </div>
                </div>

                {/* 버튼 */}
                <div className="flex gap-3">
                  <button
                    onClick={handleAddMatch}
                    disabled={!team1Player1 || !team1Player2 || !team2Player1 || !team2Player2}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ➕ 경기 추가
                  </button>
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
                  >
                    🔄 초기화
                  </button>
                </div>
              </div>

              {/* 생성된 경기 목록 */}
              <div className="space-y-3">
                <h3 className="font-semibold text-lg">생성된 경기 ({matches.length}개)</h3>
                
                {matches.length === 0 ? (
                  <div className="text-gray-500 text-center py-8 border border-dashed border-gray-300 rounded">
                    아직 생성된 경기가 없습니다.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {matches.map((match, index) => (
                      <div key={match.id} className="border rounded p-3 bg-gray-50 flex justify-between items-center">
                        <div className="flex-1">
                          <div className="font-medium mb-1">경기 {index + 1}</div>
                          <div className="text-sm space-y-1">
                            <div className="text-blue-600">
                              팀 1: {match.team1.player1.name} & {match.team1.player2.name}
                            </div>
                            <div className="text-red-600">
                              팀 2: {match.team2.player1.name} & {match.team2.player2.name}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => match.id && handleRemoveMatch(match.id)}
                          className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* 하단 버튼 */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex gap-3 justify-end">
          <button
            onClick={handleCancel}
            className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-100"
          >
            취소
          </button>
          <button
            onClick={handleComplete}
            disabled={matches.length === 0}
            className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            완료 ({matches.length}개 경기 생성)
          </button>
        </div>
      </div>
    </div>
  );
}

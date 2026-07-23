'use client';

import React from 'react';
import { Match } from '@/types';
import { getLevelScoreFromCode, type LevelInfoMap } from '@/lib/level-info';

interface GeneratedMatchesListProps {
  matches: Match[];
  playerGameCounts: Record<string, number>;
  levelInfoMap?: LevelInfoMap;
  assignType: 'today' | 'scheduled';
  setAssignType: (type: 'today' | 'scheduled') => void;
  loading: boolean;
  onClearMatches: () => void;
  onAssignMatches: () => void;
  isManualMode?: boolean;
  presentPlayers?: any[];
  onManualMatchChange?: (matches: any[]) => void;
}

export default function GeneratedMatchesList({
  matches,
  playerGameCounts,
  levelInfoMap = {},
  assignType,
  setAssignType,
  loading,
  onClearMatches,
  onAssignMatches,
  isManualMode = false,
  presentPlayers = [],
  onManualMatchChange
}: GeneratedMatchesListProps) {
  if (matches.length === 0) {
    return null;
  }

  const getGenderLabel = (gender?: string) => {
    const normalized = String(gender || '').trim().toLowerCase();
    if (['male', 'm', 'man', '남', '남성'].includes(normalized)) {
      return '남';
    }
    if (['female', 'f', 'woman', '여', '여성'].includes(normalized)) {
      return '여';
    }
    return '';
  };

  const getPlayerDisplayLabel = (player: any) => {
    if (!player || typeof player !== 'object') {
      return '미지정';
    }

    const level = String(player.skill_level || 'E2').toUpperCase();
    const gender = getGenderLabel(player.gender);
    const meta = gender ? `${gender}/${level}` : level;
    return `${player.name}(${meta})`;
  };

  const getPlayerName = (player: any) => {
    if (!player) return '미지정';
    if (typeof player === 'object' && player.name) {
      return getPlayerDisplayLabel(player);
    }
    return String(player);
  };

  const getAccuratePlayerScore = (player: any) => {
    if (!player || typeof player !== 'object') {
      return 0;
    }

    if (typeof player.score === 'number' && Number.isFinite(player.score)) {
      return player.score;
    }

    const skillLevel = String(player.skill_level || 'E2');
    return getLevelScoreFromCode(levelInfoMap, skillLevel, 0);
  };

  const getAccurateTeamScore = (team: any) => {
    if (!team?.player1 || !team?.player2) {
      return 0;
    }

    return getAccuratePlayerScore(team.player1) + getAccuratePlayerScore(team.player2);
  };

  const matchScoreDiffs = matches.map((match) => {
    const team1Score = getAccurateTeamScore(match.team1);
    const team2Score = getAccurateTeamScore(match.team2);
    return {
      matchId: match.id || '',
      team1Score,
      team2Score,
      diff: Math.abs(team1Score - team2Score),
    };
  });

  const maxScoreDiff = matchScoreDiffs.length > 0
    ? Math.max(...matchScoreDiffs.map((item) => item.diff))
    : 0;

  const scoreDiffCounts = matchScoreDiffs.reduce<Record<number, number>>((counts, item) => {
    counts[item.diff] = (counts[item.diff] || 0) + 1;
    return counts;
  }, {});
  const scoreDiffSummary = Object.entries(scoreDiffCounts)
    .map(([diff, count]) => ({ diff: Number(diff), count }))
    .sort((left, right) => left.diff - right.diff);
  const playerCountEntries = Object.entries(playerGameCounts);
  const averageGameCount = playerCountEntries.length > 0
    ? Object.values(playerGameCounts).reduce((sum, count) => sum + count, 0) / playerCountEntries.length
    : 0;

  const handlePlayerSelect = (matchIdx: number, team: 'team1' | 'team2', slot: 'player1' | 'player2', playerId: string) => {
    if (!onManualMatchChange) return;
    const player = presentPlayers.find(p => p.id === playerId) || null;
    const updatedMatches = matches.map((m, idx) => {
      if (idx !== matchIdx) return m;
      const newMatch = JSON.parse(JSON.stringify(m));
      newMatch[team][slot] = player;
      return newMatch;
    });
    onManualMatchChange(updatedMatches);
  };

  const getAvailablePlayers = (match: any) => {
    const selectedIds = new Set<string>();
    if (match.team1?.player1?.id) selectedIds.add(match.team1.player1.id);
    if (match.team1?.player2?.id) selectedIds.add(match.team1.player2.id);
    if (match.team2?.player1?.id) selectedIds.add(match.team2.player1.id);
    if (match.team2?.player2?.id) selectedIds.add(match.team2.player2.id);
    return presentPlayers
      .filter((player) => !selectedIds.has(player.id))
      .slice()
      .sort((left, right) => {
        const scoreDiff = getAccuratePlayerScore(right) - getAccuratePlayerScore(left);
        if (Math.abs(scoreDiff) > 0.0001) {
          return scoreDiff;
        }

        const nameDiff = (left.name || '').localeCompare(right.name || '', 'ko', { sensitivity: 'base' });
        if (nameDiff !== 0) {
          return nameDiff;
        }

        return String(left.id || '').localeCompare(String(right.id || ''), 'ko', { sensitivity: 'base' });
      });
  };

  return (
    <div className="mt-6">
      {/* 경기 목록 테이블 */}
      <h3 className="text-lg font-semibold mb-3">
        {isManualMode ? '✋ 수동 배정 - 선수 선택' : '생성된 경기'} ({matches.length}경기)
      </h3>
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800">
          점수차이: <span className="font-bold">{scoreDiffSummary.map(({ diff, count }) => `${diff}점: ${count}`).join(', ')}</span>
        </div>
      </div>
      
      {/* 모바일 최적화 카드 뷰 (md:hidden) */}
      <div className="block md:hidden space-y-4 mb-6">
        {matches.map((match, index) => {
          const scoreDiffEntry = matchScoreDiffs[index];
          const isWorstMatch = scoreDiffEntry && scoreDiffEntry.diff === maxScoreDiff && maxScoreDiff > 0;
          
          return (
            <div 
              key={match.id || `match-mobile-${index}`}
              className={`rounded-xl border p-4 space-y-3 transition-all ${
                isWorstMatch 
                  ? 'border-rose-200 bg-rose-50/30' 
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="font-bold text-slate-800 text-sm"># {index + 1}회차 경기</span>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    isWorstMatch ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-700'
                  }`}>
                    점수차: {scoreDiffEntry.diff.toFixed(0)}점
                  </span>
                  {isWorstMatch && (
                    <span className="text-[9px] font-bold text-rose-600 bg-rose-100/50 px-1.5 py-0.5 rounded">최대 편차</span>
                  )}
                </div>
              </div>

              {isManualMode ? (
                <div className="space-y-3">
                  {/* 라켓팀 선택 */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-blue-600">🔵 팀 1</span>
                      {(match.team1?.player1 || match.team1?.player2) && (
                        <span className="text-[10px] font-semibold text-blue-500 bg-blue-50 px-1.5 rounded">
                          합계: {getAccurateTeamScore(match.team1).toFixed(0)}점
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select 
                        value={match.team1?.player1?.id || ''} 
                        onChange={(e) => handlePlayerSelect(index, 'team1', 'player1', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded-lg text-xs bg-white text-slate-800"
                      >
                        <option value="">선수 선택</option>
                        {match.team1?.player1 && (
                          <option key={match.team1.player1.id} value={match.team1.player1.id}>
                            {getPlayerDisplayLabel(match.team1.player1)}
                          </option>
                        )}
                        {getAvailablePlayers(match).map(p => (
                          <option key={p.id} value={p.id}>
                            {getPlayerDisplayLabel(p)}
                          </option>
                        ))}
                      </select>
                      <select 
                        value={match.team1?.player2?.id || ''} 
                        onChange={(e) => handlePlayerSelect(index, 'team1', 'player2', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded-lg text-xs bg-white text-slate-800"
                      >
                        <option value="">선수 선택</option>
                        {match.team1?.player2 && (
                          <option key={match.team1.player2.id} value={match.team1.player2.id}>
                            {getPlayerDisplayLabel(match.team1.player2)}
                          </option>
                        )}
                        {getAvailablePlayers(match).map(p => (
                          <option key={p.id} value={p.id}>
                            {getPlayerDisplayLabel(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* 셔틀팀 선택 */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-red-600">🔴 팀 2</span>
                      {(match.team2?.player1 || match.team2?.player2) && (
                        <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 rounded">
                          합계: {getAccurateTeamScore(match.team2).toFixed(0)}점
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <select 
                        value={match.team2?.player1?.id || ''} 
                        onChange={(e) => handlePlayerSelect(index, 'team2', 'player1', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded-lg text-xs bg-white text-slate-800"
                      >
                        <option value="">선수 선택</option>
                        {match.team2?.player1 && (
                          <option key={match.team2.player1.id} value={match.team2.player1.id}>
                            {getPlayerDisplayLabel(match.team2.player1)}
                          </option>
                        )}
                        {getAvailablePlayers(match).map(p => (
                          <option key={p.id} value={p.id}>
                            {getPlayerDisplayLabel(p)}
                          </option>
                        ))}
                      </select>
                      <select 
                        value={match.team2?.player2?.id || ''} 
                        onChange={(e) => handlePlayerSelect(index, 'team2', 'player2', e.target.value)}
                        className="w-full px-2 py-1.5 border rounded-lg text-xs bg-white text-slate-800"
                      >
                        <option value="">선수 선택</option>
                        {match.team2?.player2 && (
                          <option key={match.team2.player2.id} value={match.team2.player2.id}>
                            {getPlayerDisplayLabel(match.team2.player2)}
                          </option>
                        )}
                        {getAvailablePlayers(match).map(p => (
                          <option key={p.id} value={p.id}>
                            {getPlayerDisplayLabel(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 text-xs">
                  {/* 라켓팀 표시 */}
                  <div className="space-y-1 bg-blue-50/40 p-2.5 rounded-lg border border-blue-100/50">
                    <div className="font-bold text-blue-600 mb-0.5">🔵 팀 1 ({getAccurateTeamScore(match.team1).toFixed(0)}점)</div>
                    <div className="text-slate-800 font-medium leading-relaxed truncate" title={getPlayerName(match.team1.player1)}>
                      {getPlayerName(match.team1.player1)}
                    </div>
                    <div className="text-slate-800 font-medium leading-relaxed truncate" title={getPlayerName(match.team1.player2)}>
                      {getPlayerName(match.team1.player2)}
                    </div>
                  </div>

                  {/* 셔틀팀 표시 */}
                  <div className="space-y-1 bg-red-50/40 p-2.5 rounded-lg border border-red-100/50">
                    <div className="font-bold text-red-600 mb-0.5">🔴 팀 2 ({getAccurateTeamScore(match.team2).toFixed(0)}점)</div>
                    <div className="text-slate-800 font-medium leading-relaxed truncate" title={getPlayerName(match.team2.player1)}>
                      {getPlayerName(match.team2.player1)}
                    </div>
                    <div className="text-slate-800 font-medium leading-relaxed truncate" title={getPlayerName(match.team2.player2)}>
                      {getPlayerName(match.team2.player2)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 데스크톱 화면용 테이블 뷰 (hidden md:block) */}
      <div className="hidden md:block overflow-x-auto mb-6">
        <table className="w-full border-collapse border border-gray-300 bg-white">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-sm">회차</th>
              <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-sm">팀 1</th>
              <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-sm">팀 2</th>
              <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-sm">점수 차이</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match, index) => {
              const scoreDiffEntry = matchScoreDiffs[index];
              const isWorstMatch = scoreDiffEntry && scoreDiffEntry.diff === maxScoreDiff && maxScoreDiff > 0;

              return (
              <tr
                key={match.id || `match-${index}`}
                className={`${isWorstMatch ? 'bg-rose-50 hover:bg-rose-100' : 'hover:bg-gray-50'}`}
              >
                <td className="border border-gray-300 px-2 py-2 text-center font-medium text-sm">
                  {index + 1}
                </td>
                {isManualMode ? (
                  <>
                    <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                      <div className="flex items-center gap-2 p-2">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select 
                            value={match.team1?.player1?.id || ''} 
                            onChange={(e) => handlePlayerSelect(index, 'team1', 'player1', e.target.value)}
                            className="px-2 py-1 border rounded text-xs"
                          >
                            <option value="">선수 선택</option>
                            {match.team1?.player1 && (
                              <option key={match.team1.player1.id} value={match.team1.player1.id}>
                                {getPlayerDisplayLabel(match.team1.player1)}
                              </option>
                            )}
                            {getAvailablePlayers(match).map(p => (
                              <option key={p.id} value={p.id}>
                                {getPlayerDisplayLabel(p)}
                              </option>
                            ))}
                          </select>
                          <select 
                            value={match.team1?.player2?.id || ''} 
                            onChange={(e) => handlePlayerSelect(index, 'team1', 'player2', e.target.value)}
                            className="px-2 py-1 border rounded text-xs"
                          >
                            <option value="">선수 선택</option>
                            {match.team1?.player2 && (
                              <option key={match.team1.player2.id} value={match.team1.player2.id}>
                                {getPlayerDisplayLabel(match.team1.player2)}
                              </option>
                            )}
                            {getAvailablePlayers(match).map(p => (
                              <option key={p.id} value={p.id}>
                                {getPlayerDisplayLabel(p)}
                              </option>
                            ))}
                          </select>
                        </div>
                        {(match.team1?.player1 || match.team1?.player2) && (
                          <div className="text-xs font-bold text-blue-600 whitespace-nowrap px-2">
                            ({getAccurateTeamScore(match.team1).toFixed(0)})
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                      <div className="flex items-center gap-2 p-2">
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <select 
                            value={match.team2?.player1?.id || ''} 
                            onChange={(e) => handlePlayerSelect(index, 'team2', 'player1', e.target.value)}
                            className="px-2 py-1 border rounded text-xs"
                          >
                            <option value="">선수 선택</option>
                            {match.team2?.player1 && (
                              <option key={match.team2.player1.id} value={match.team2.player1.id}>
                                {getPlayerDisplayLabel(match.team2.player1)}
                              </option>
                            )}
                            {getAvailablePlayers(match).map(p => (
                              <option key={p.id} value={p.id}>
                                {getPlayerDisplayLabel(p)}
                              </option>
                            ))}
                          </select>
                          <select 
                            value={match.team2?.player2?.id || ''} 
                            onChange={(e) => handlePlayerSelect(index, 'team2', 'player2', e.target.value)}
                            className="px-2 py-1 border rounded text-xs"
                          >
                            <option value="">선수 선택</option>
                            {match.team2?.player2 && (
                              <option key={match.team2.player2.id} value={match.team2.player2.id}>
                                {getPlayerDisplayLabel(match.team2.player2)}
                              </option>
                            )}
                            {getAvailablePlayers(match).map(p => (
                              <option key={p.id} value={p.id}>
                                {getPlayerDisplayLabel(p)}
                              </option>
                            ))}
                          </select>
                        </div>
                        {(match.team2?.player1 || match.team2?.player2) && (
                          <div className="text-xs font-bold text-red-600 whitespace-nowrap px-2">
                            ({getAccurateTeamScore(match.team2).toFixed(0)})
                          </div>
                        )}
                      </div>
                    </td>
                    <td className={`border border-gray-300 px-2 py-2 text-center text-xs font-semibold ${isWorstMatch ? 'text-rose-700' : 'text-gray-700'}`}>
                      {scoreDiffEntry.diff.toFixed(0)}점
                      {isWorstMatch && (
                        <div className="mt-1 text-[11px] font-medium text-rose-600">최대 편차</div>
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="border border-gray-300 px-2 py-2 text-center text-blue-600 text-xs">
                      {getPlayerName(match.team1.player1)}, {getPlayerName(match.team1.player2)}
                      <span className="text-xs text-gray-500 ml-2">({getAccurateTeamScore(match.team1).toFixed(0)})</span>
                    </td>
                    <td className="border border-gray-300 px-2 py-2 text-center text-red-600 text-xs">
                      {getPlayerName(match.team2.player1)}, {getPlayerName(match.team2.player2)}
                      <span className="text-xs text-gray-500 ml-2">({getAccurateTeamScore(match.team2).toFixed(0)})</span>
                    </td>
                    <td className={`border border-gray-300 px-2 py-2 text-center text-xs font-semibold ${isWorstMatch ? 'bg-rose-100 text-rose-700' : 'text-gray-700'}`}>
                      {scoreDiffEntry.diff.toFixed(0)}점
                      {isWorstMatch && (
                        <div className="mt-1 text-[11px] font-medium text-rose-600">최대 편차</div>
                      )}
                    </td>
                  </>
                )}
              </tr>
            )})}
          </tbody>
        </table>
      </div>

      {/* 1인당 게임수 표시 */}
      {playerCountEntries.length > 0 && (
        <div className="mb-6">
          <h4 className="text-lg font-semibold mb-3 text-slate-800">1인당 총 게임수</h4>
          <div className="bg-gray-50 p-4 rounded-xl border border-slate-200">
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2 text-sm">
              {playerCountEntries
                .sort(([nameA], [nameB]) => nameA.localeCompare(nameB, 'ko', { sensitivity: 'base' })) // 한글 사전(ㄱㄴㄷ) 순 정렬
                .map(([playerName, gameCount]) => (
                  <div key={playerName} className="flex justify-between items-center bg-white p-2 rounded border border-slate-200 shadow-3xs">
                    <span className="truncate mr-1.5 font-medium text-slate-700 text-xs">{playerName}</span>
                    <span className={`flex-shrink-0 font-bold text-xs ${gameCount > averageGameCount ? 'text-rose-600' : 'text-indigo-600'}`}>{gameCount}경기</span>
                  </div>
                ))}
            </div>
            <div className="mt-3 text-xs text-gray-600">
              <div className="flex flex-wrap gap-4">
                <span>총 선수: {playerCountEntries.length}명</span>
                <span>총 경기: {matches.length}경기</span>
                <span>평균 경기수: {averageGameCount.toFixed(1)}경기/인</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 배정 옵션 섹션 */}
      <div className="p-4 bg-gray-50 rounded-lg">
        <h4 className="text-lg font-semibold mb-4 text-gray-800">🎯 경기 배정하기</h4>
        <p className="text-sm text-gray-600 mb-4">
          생성된 {matches.length}개의 경기를 어떻게 배정하시겠습니까?
        </p>
        {/* 세션명은 자동 생성됩니다. */}
        
        <div className="flex flex-row gap-2">
          <button
            onClick={onClearMatches}
            className="flex-1 py-2 px-3 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg text-xs font-semibold transition-colors"
            disabled={loading}
          >
            경기 초기화
          </button>
          <button
            onClick={() => {
              if (isManualMode) {
                const incomplete = matches.some(m => !m.team1?.player1 || !m.team1?.player2 || !m.team2?.player1 || !m.team2?.player2);
                if (incomplete) {
                  alert('모든 회차의 4명 슬롯을 채워주세요.');
                  return;
                }
              }
              onAssignMatches();
            }}
            disabled={loading || matches.length === 0}
            className="flex-1 py-2 px-3 bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 disabled:bg-gray-400 text-white rounded-lg text-xs font-semibold transition-all shadow-sm"
          >
            {loading ? '배정 중...' : '✨ 배정하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

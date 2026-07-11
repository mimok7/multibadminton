'use client';

import React from 'react';
import { ExtendedPlayer } from '../types';

interface ManualMatchesEditorProps {
  matches: any[]; // editable matches where team slots can be null
  presentPlayers: ExtendedPlayer[];
  onChange: (matches: any[]) => void;
  onAssign: () => void;
  onCancel: () => void;
  playerGameCounts: Record<string, number>;
}

export default function ManualMatchesEditor({ matches, presentPlayers, onChange, onAssign, onCancel, playerGameCounts }: ManualMatchesEditorProps) {
  const handleSelect = (matchIdx: number, team: 'team1' | 'team2', slot: 'player1' | 'player2', playerId: string) => {
    const player = presentPlayers.find(p => p.id === playerId) || null;
    const next = matches.map((m, idx) => idx === matchIdx ? JSON.parse(JSON.stringify(m)) : JSON.parse(JSON.stringify(m)));
    next[matchIdx][team][slot] = player;
    onChange(next);
  };

  // prevent selecting same player twice within same match
  const isSelectedInMatch = (match: any, playerId: string) => {
    if (!playerId) return false;
    const ids = [] as string[];
    if (match.team1.player1) ids.push(match.team1.player1.id);
    if (match.team1.player2) ids.push(match.team1.player2.id);
    if (match.team2.player1) ids.push(match.team2.player1.id);
    if (match.team2.player2) ids.push(match.team2.player2.id);
    return ids.includes(playerId);
  };

  return (
    <div className="mb-6 p-4 border border-yellow-300 rounded bg-yellow-50">
      <h3 className="text-lg font-semibold mb-3">✋ 수동 배정 편집기</h3>
      <p className="text-sm text-gray-600 mb-3">아래 각 회차에서 선수를 선택하세요. 초기에는 모든 슬롯이 비어 있습니다.</p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-gray-300 bg-white">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-sm">회차</th>
              <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-sm">팀 1</th>
              <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-sm">팀 2</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((match, idx) => (
              <tr key={match.id || `manual-${idx}`} className="hover:bg-gray-50">
                <td className="border border-gray-300 px-2 py-2 text-center font-medium text-sm">{idx + 1}</td>
                <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select value={match.team1.player1?.id || ''} onChange={(e) => handleSelect(idx, 'team1', 'player1', e.target.value)} className="px-2 py-1 border rounded">
                      <option value="">선수 선택</option>
                      {presentPlayers.map(p => (
                        <option key={p.id} value={p.id} disabled={isSelectedInMatch(match, p.id) && match.team1.player1?.id !== p.id}>{p.name} ({p.skill_label})</option>
                      ))}
                    </select>
                    <select value={match.team1.player2?.id || ''} onChange={(e) => handleSelect(idx, 'team1', 'player2', e.target.value)} className="px-2 py-1 border rounded">
                      <option value="">선수 선택</option>
                      {presentPlayers.map(p => (
                        <option key={p.id} value={p.id} disabled={isSelectedInMatch(match, p.id) && match.team1.player2?.id !== p.id}>{p.name} ({p.skill_label})</option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="border border-gray-300 px-2 py-2 text-center text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select value={match.team2.player1?.id || ''} onChange={(e) => handleSelect(idx, 'team2', 'player1', e.target.value)} className="px-2 py-1 border rounded">
                      <option value="">선수 선택</option>
                      {presentPlayers.map(p => (
                        <option key={p.id} value={p.id} disabled={isSelectedInMatch(match, p.id) && match.team2.player1?.id !== p.id}>{p.name} ({p.skill_label})</option>
                      ))}
                    </select>
                    <select value={match.team2.player2?.id || ''} onChange={(e) => handleSelect(idx, 'team2', 'player2', e.target.value)} className="px-2 py-1 border rounded">
                      <option value="">선수 선택</option>
                      {presentPlayers.map(p => (
                        <option key={p.id} value={p.id} disabled={isSelectedInMatch(match, p.id) && match.team2.player2?.id !== p.id}>{p.name} ({p.skill_label})</option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex gap-3 items-center flex-wrap">
        <button onClick={onAssign} className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">✅ 배정 준비 완료</button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">❌ 취소</button>
        <div className="px-3 py-2 bg-white rounded border flex items-center text-sm">선택된 총 게임수: <span className="ml-2 font-bold text-blue-600">{Object.values(playerGameCounts).reduce((a,b)=>a+(b||0),0)}</span></div>
      </div>

    </div>
  );
}

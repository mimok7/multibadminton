'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

type MatchData = {
  id: string;
  tournament_id: string;
  round: number;
  match_number: number;
  team1: string[];
  team2: string[];
  court: string;
  status: string;
  score_team1: number;
  score_team2: number;
  winner: string | null;
  referee_id: string | null;
  referee_name: string | null;
};

export default function ScoreboardPage() {
  const params = useParams();
  const router = useRouter();
  const matchId = params?.matchId as string;

  const [match, setMatch] = useState<MatchData | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [isReferee, setIsReferee] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [score1, setScore1] = useState(0);
  const [score2, setScore2] = useState(0);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [showConfirmComplete, setShowConfirmComplete] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isLive, setIsLive] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 매치 데이터 로드
  const fetchMatch = useCallback(async () => {
    if (!matchId) return;

    try {
      const res = await fetch(`/api/scoreboard/${matchId}`, { cache: 'no-store' });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '경기 정보를 불러올 수 없습니다.');
        return;
      }

      setMatch(data.match);
      setCanEdit(data.canEdit);
      setIsReferee(data.isReferee);
      setIsAdmin(data.isAdmin ?? false);
      setScore1(data.match.score_team1 ?? 0);
      setScore2(data.match.score_team2 ?? 0);
      setError(null);
    } catch {
      setError('서버에 연결할 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  useEffect(() => {
    fetchMatch();
  }, [fetchMatch]);

  const handleGoBack = useCallback(() => {
    const tournamentId = match?.tournament_id;
    const destPath = isAdmin ? '/manager/tournament-bracket' : '/tournament-bracket';
    const destination = tournamentId ? `${destPath}?tournament=${tournamentId}` : destPath;
    
    if (typeof window !== 'undefined' && window.history.length > 1 && document.referrer) {
      router.back();
    } else {
      router.push(destination);
    }
  }, [match?.tournament_id, isAdmin, router]);

  const handleGoBackFallback = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1 && document.referrer) {
      router.back();
    } else {
      router.push('/tournament-bracket');
    }
  }, [router]);

  // Supabase Realtime 구독 (관전자용)
  useEffect(() => {
    if (!matchId) return;

    const supabase = getSupabaseClient();
    if (!supabase || !supabase.channel) return;

    const channel = supabase
      .channel(`scoreboard-${matchId}`)
      .on(
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tournament_matches',
          filter: `id=eq.${matchId}`,
        },
        (payload: any) => {
          const newData = payload.new;
          if (newData) {
            setMatch((prev) =>
              prev
                ? {
                    ...prev,
                    score_team1: newData.score_team1 ?? prev.score_team1,
                    score_team2: newData.score_team2 ?? prev.score_team2,
                    status: newData.status ?? prev.status,
                    winner: newData.winner ?? prev.winner,
                  }
                : prev
            );

            // 관전 모드에서는 점수도 갱신
            if (!canEdit) {
              setScore1(newData.score_team1 ?? 0);
              setScore2(newData.score_team2 ?? 0);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchId, canEdit]);

  // 10초마다 자동 새로고침 (라이브 보기 ON 이고 관전자 모드일 때)
  useEffect(() => {
    if (!isLive || match?.status === 'completed' || loading || canEdit) return;

    const interval = setInterval(() => {
      fetchMatch();
    }, 10000);

    return () => clearInterval(interval);
  }, [isLive, match?.status, loading, canEdit, fetchMatch]);

  // 점수 서버 저장 (debounce)
  const saveScore = useCallback(
    async (s1: number, s2: number) => {
      if (!matchId || !canEdit) return;
      setSaving(true);

      try {
        await fetch(`/api/scoreboard/${matchId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ score_team1: s1, score_team2: s2 }),
        });
      } catch {
        // silent fail - will retry on next score change
      } finally {
        setSaving(false);
      }
    },
    [matchId, canEdit]
  );

  const debouncedSave = useCallback(
    (s1: number, s2: number) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveScore(s1, s2);
      }, 300);
    },
    [saveScore]
  );

  // 점수 변경 핸들러
  const handleScoreChange = useCallback(
    (team: 'team1' | 'team2', delta: number) => {
      if (!canEdit || match?.status === 'completed') return;

      if (team === 'team1') {
        setScore1((prev) => {
          const next = Math.max(0, prev + delta);
          debouncedSave(next, score2);
          return next;
        });
      } else {
        setScore2((prev) => {
          const next = Math.max(0, prev + delta);
          debouncedSave(score1, next);
          return next;
        });
      }
    },
    [canEdit, match?.status, score1, score2, debouncedSave]
  );

  // 경기 완료
  const handleCompleteMatch = async () => {
    if (!matchId || !canEdit || completing) return;
    setCompleting(true);

    try {
      const res = await fetch(`/api/scoreboard/${matchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score_team1: score1, score_team2: score2 }),
      });

      const data = await res.json();
      if (res.ok) {
        setMatch((prev) =>
          prev ? { ...prev, status: 'completed', winner: data.winner } : prev
        );
        setShowConfirmComplete(false);
      } else {
        alert(data.error || '경기 완료 처리에 실패했습니다.');
      }
    } catch {
      alert('서버 오류가 발생했습니다.');
    } finally {
      setCompleting(false);
    }
  };

  // 전체화면 토글
  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      try {
        await containerRef.current?.requestFullscreen?.();
        setIsFullscreen(true);
        if (screen.orientation && typeof (screen.orientation as any).lock === 'function') {
          await (screen.orientation as any).lock('landscape').catch((err: any) => {
            console.warn('Orientation lock failed:', err);
          });
        }
      } catch (err) {
        console.warn('Fullscreen request failed:', err);
      }
    } else {
      try {
        await document.exitFullscreen?.();
        setIsFullscreen(false);
        if (screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
          (screen.orientation as any).unlock();
        }
      } catch (err) {
        console.warn('Fullscreen exit failed:', err);
      }
    }
  };

  useEffect(() => {
    const handler = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      if (!isFull) {
        if (screen.orientation && typeof (screen.orientation as any).unlock === 'function') {
          try {
            (screen.orientation as any).unlock();
          } catch {}
        }
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // --- 로딩/에러 상태 ---
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900">
        <div className="text-lg text-white">점수판 로딩 중...</div>
      </div>
    );
  }

  if (error || !match) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 px-6">
        <div className="text-lg text-rose-400">{error || '경기를 찾을 수 없습니다.'}</div>
        <button
          onClick={handleGoBackFallback}
          className="rounded-xl bg-white/10 px-6 py-3 text-white transition hover:bg-white/20"
        >
          돌아가기
        </button>
      </div>
    );
  }




  const isCompleted = match.status === 'completed';
  const rawTeam1Names = Array.isArray(match.team1)
    ? match.team1.map((n) => n.replace(/\([^)]*\)$/, '').trim())
    : [];
  const rawTeam2Names = Array.isArray(match.team2)
    ? match.team2.map((n) => n.replace(/\([^)]*\)$/, '').trim())
    : [];

  // 반전 모드: 좌우 팀/점수/색상을 뒤집음
  const leftNames = isFlipped ? rawTeam2Names : rawTeam1Names;
  const rightNames = isFlipped ? rawTeam1Names : rawTeam2Names;
  const leftScore = isFlipped ? score2 : score1;
  const rightScore = isFlipped ? score1 : score2;
  const leftTeamKey: 'team1' | 'team2' = isFlipped ? 'team2' : 'team1';
  const rightTeamKey: 'team1' | 'team2' = isFlipped ? 'team1' : 'team2';
  const leftWinner = isFlipped ? 'team2' : 'team1';
  const rightWinner = isFlipped ? 'team1' : 'team2';

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-screen flex-col bg-slate-900 select-none"
      style={{ touchAction: 'manipulation' }}
    >
      {/* 상단 정보 바 */}
      <div className="relative z-10 flex flex-wrap items-center justify-between bg-black/60 px-3 py-2 max-[400px]:px-2 max-[400px]:py-1 text-white backdrop-blur-md gap-1">
        <button
          onClick={handleGoBack}
          className="rounded-lg bg-white/10 px-3 py-1.5 max-[400px]:px-2 max-[400px]:py-1 text-xs max-[400px]:text-[10px] font-medium transition hover:bg-white/20"
        >
          ← 돌아가기
        </button>

        <div className="text-center max-[400px]:hidden">
          <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {match.court?.replace(/Court\s*/i, '코트 ') || '코트'}
            {' · '}
            {match.match_number}경기
          </div>
          <div className="flex items-center gap-2">
            {saving && (
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            )}
            {isCompleted && (
              <span className="rounded-full bg-slate-500/30 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                경기종료
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 max-[400px]:gap-1">
          {!isCompleted && (
            <button
              onClick={() => setIsLive((prev) => !prev)}
              className={`rounded-lg px-3 py-1.5 max-[400px]:px-2 max-[400px]:py-1 text-xs max-[400px]:text-[10px] font-bold transition-all ${
                isLive
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                  : 'bg-white/10 text-slate-400 hover:bg-white/20'
              }`}
              title="라이브 보기 토글"
            >
              {isLive ? '🟢 라이브 ON' : '⚫ 라이브 OFF'}
            </button>
          )}
          <button
            onClick={fetchMatch}
            className="rounded-lg bg-white/10 px-3 py-1.5 max-[400px]:px-2 max-[400px]:py-1 text-xs max-[400px]:text-[10px] font-medium transition hover:bg-white/20"
            title="새로고침"
          >
            <span className="max-[400px]:hidden">🔁 새로고침</span>
            <span className="hidden max-[400px]:inline">🔁</span>
          </button>
          <button
            onClick={() => setIsFlipped((prev) => !prev)}
            className="rounded-lg bg-white/10 px-3 py-1.5 max-[400px]:px-2 max-[400px]:py-1 text-xs max-[400px]:text-[10px] font-medium transition hover:bg-white/20"
            title="좌우 반전"
          >
            <span className="max-[400px]:hidden">🔄 반전</span>
            <span className="hidden max-[400px]:inline">🔄</span>
          </button>
          <button
            onClick={toggleFullscreen}
            className="rounded-lg bg-white/10 px-3 py-1.5 max-[400px]:px-2 max-[400px]:py-1 text-xs max-[400px]:text-[10px] font-medium transition hover:bg-white/20"
          >
            {isFullscreen ? '축소' : '확대'}
          </button>
        </div>
      </div>

      {/* 심판 정보 */}
      {match.referee_name && (
        <div className="bg-black/40 px-3 py-1 text-center text-[11px] text-slate-400">
          심판: <span className="font-semibold text-white">{match.referee_name}</span>
          {isReferee && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-400">
              내가 심판
            </span>
          )}
        </div>
      )}

      {/* 메인 점수판 영역 */}
      <div className="relative flex flex-1">
        {/* 좌측 팀 (기본: 파랑/팀1, 반전: 빨강/팀2) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => canEdit && !isCompleted && handleScoreChange(leftTeamKey, 1)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (canEdit && !isCompleted) handleScoreChange(leftTeamKey, 1); } }}
          className={`group relative flex flex-1 flex-col items-center justify-center transition-all duration-150 active:brightness-110 ${
            canEdit && !isCompleted
              ? 'cursor-pointer active:scale-[0.98]'
              : 'cursor-default'
          }`}
          style={{
            background: isCompleted
              ? (isFlipped ? 'linear-gradient(180deg, #5f1e1e 0%, #44100f 100%)' : 'linear-gradient(180deg, #1e3a5f 0%, #0f2744 100%)')
              : (isFlipped ? 'linear-gradient(180deg, #dc2626 0%, #b91c1c 40%, #991b1b 100%)' : 'linear-gradient(180deg, #1d4ed8 0%, #1e40af 40%, #1e3a8a 100%)'),
          }}
        >
          {/* 좌측 선수 이름 */}
          <div className="absolute top-4 left-0 right-0 flex flex-col items-center gap-0.5 px-3 max-[400px]:top-2 max-[400px]:px-1 max-[400px]:gap-0">
            {leftNames.map((name, i) => (
              <span
                key={i}
                className="text-sm font-semibold text-white/80 drop-shadow-md sm:text-base max-[400px]:text-[11px] max-[400px]:leading-tight max-[400px]:truncate max-[400px]:w-full max-[400px]:text-center"
              >
                {name}
              </span>
            ))}
          </div>

          {/* 점수 */}
          <div className="relative">
            <span
              className="text-[120px] font-black leading-none text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)] sm:text-[160px] max-[400px]:text-[30vw]"
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              {leftScore}
            </span>
          </div>

          {/* -1 버튼 */}
          {canEdit && !isCompleted && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleScoreChange(leftTeamKey, -1);
              }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/30 px-5 py-2 text-sm font-bold text-white/80 backdrop-blur-sm transition hover:bg-black/50 active:scale-95 max-[400px]:bottom-3 max-[400px]:px-4 max-[400px]:py-1.5 max-[400px]:text-xs"
            >
              −1
            </button>
          )}

          {/* 승자 표시 */}
          {isCompleted && match.winner === leftWinner && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-4 py-1.5 text-sm font-black text-slate-900 shadow-lg">
              🏆 승리
            </div>
          )}
        </div>

        {/* 중앙 구분선 */}
        <div className="absolute inset-y-0 left-1/2 z-10 flex w-0 -translate-x-1/2 items-center justify-center max-[400px]:hidden">
          <div className="h-full w-px bg-white/20" />
          <div className="absolute rounded-full bg-slate-900 px-2.5 py-3 text-xs font-black text-white shadow-xl ring-2 ring-white/20">
            VS
          </div>
        </div>

        {/* 우측 팀 (기본: 빨강/팀2, 반전: 파랑/팀1) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => canEdit && !isCompleted && handleScoreChange(rightTeamKey, 1)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (canEdit && !isCompleted) handleScoreChange(rightTeamKey, 1); } }}
          className={`group relative flex flex-1 flex-col items-center justify-center transition-all duration-150 active:brightness-110 ${
            canEdit && !isCompleted
              ? 'cursor-pointer active:scale-[0.98]'
              : 'cursor-default'
          }`}
          style={{
            background: isCompleted
              ? (isFlipped ? 'linear-gradient(180deg, #1e3a5f 0%, #0f2744 100%)' : 'linear-gradient(180deg, #5f1e1e 0%, #44100f 100%)')
              : (isFlipped ? 'linear-gradient(180deg, #1d4ed8 0%, #1e40af 40%, #1e3a8a 100%)' : 'linear-gradient(180deg, #dc2626 0%, #b91c1c 40%, #991b1b 100%)'),
          }}
        >
          {/* 우측 선수 이름 */}
          <div className="absolute top-4 left-0 right-0 flex flex-col items-center gap-0.5 px-3 max-[400px]:top-2 max-[400px]:px-1 max-[400px]:gap-0">
            {rightNames.map((name, i) => (
              <span
                key={i}
                className="text-sm font-semibold text-white/80 drop-shadow-md sm:text-base max-[400px]:text-[11px] max-[400px]:leading-tight max-[400px]:truncate max-[400px]:w-full max-[400px]:text-center"
              >
                {name}
              </span>
            ))}
          </div>

          {/* 점수 */}
          <div className="relative">
            <span
              className="text-[120px] font-black leading-none text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.5)] sm:text-[160px] max-[400px]:text-[30vw]"
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              {rightScore}
            </span>
          </div>

          {/* -1 버튼 */}
          {canEdit && !isCompleted && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleScoreChange(rightTeamKey, -1);
              }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/30 px-5 py-2 text-sm font-bold text-white/80 backdrop-blur-sm transition hover:bg-black/50 active:scale-95 max-[400px]:bottom-3 max-[400px]:px-4 max-[400px]:py-1.5 max-[400px]:text-xs"
            >
              −1
            </button>
          )}

          {/* 승자 표시 */}
          {isCompleted && match.winner === rightWinner && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-4 py-1.5 text-sm font-black text-slate-900 shadow-lg">
              🏆 승리
            </div>
          )}
        </div>
      </div>

      {/* 하단 컨트롤 바 */}
      {canEdit && !isCompleted && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-3 bg-black/70 px-4 py-3 max-[400px]:px-2 max-[400px]:py-2 backdrop-blur-md">
          {!showConfirmComplete ? (
            <button
              type="button"
              onClick={() => setShowConfirmComplete(true)}
              className="rounded-2xl max-[400px]:rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-8 py-3 max-[400px]:px-4 max-[400px]:py-2 text-sm max-[400px]:text-xs font-bold text-white shadow-lg transition hover:from-emerald-500 hover:to-emerald-400 active:scale-95"
            >
              경기 완료
            </button>
          ) : (
            <div className="flex flex-wrap items-center justify-center gap-2 max-[400px]:gap-1">
              <span className="text-sm max-[400px]:text-xs text-white max-[400px]:w-full max-[400px]:text-center">
                {score1} : {score2} 로 확정하시겠습니까?
              </span>
              <button
                type="button"
                onClick={handleCompleteMatch}
                disabled={completing}
                className="rounded-xl max-[400px]:rounded-lg bg-emerald-600 px-5 py-2 max-[400px]:px-3 max-[400px]:py-1.5 text-sm max-[400px]:text-[11px] font-bold text-white transition hover:bg-emerald-500 active:scale-95 disabled:opacity-50"
              >
                {completing ? '처리중...' : '확인'}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirmComplete(false)}
                className="rounded-xl max-[400px]:rounded-lg bg-white/10 px-5 py-2 max-[400px]:px-3 max-[400px]:py-1.5 text-sm max-[400px]:text-[11px] font-medium text-white transition hover:bg-white/20"
              >
                취소
              </button>
            </div>
          )}
        </div>
      )}

      {/* 관전 모드 안내 */}
      {!canEdit && !isCompleted && (
        <div className="relative z-10 flex items-center justify-center bg-black/50 px-4 py-3 backdrop-blur-md">
          <span className="text-sm text-slate-400">
            {isLive 
              ? '👀 관전 모드 — 10초마다 자동 새로고침 중' 
              : '👀 관전 모드 — 라이브 오프시는 새로고침 버튼 누르면 갱신됩니다'}
          </span>
        </div>
      )}

      {/* 경기 완료 후 안내 */}
      {isCompleted && (
        <div className="relative z-10 flex items-center justify-center gap-4 bg-black/70 px-4 py-3 backdrop-blur-md">
          <span className="text-sm font-semibold text-white">
            경기 종료 — 최종 {score1} : {score2}
          </span>
          <button
            onClick={handleGoBack}
            className="rounded-xl bg-white/10 px-5 py-2 text-sm font-medium text-white transition hover:bg-white/20"
          >
            대진표로 돌아가기
          </button>
        </div>
      )}
    </div>
  );
}

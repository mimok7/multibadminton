'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarDays, MapPin, Users, Target, ArrowLeft } from 'lucide-react';

import { RequireAuth } from '@/components/AuthGuard';
import { Button } from '@/components/ui/button';
import { useLevelInfoMap } from '@/hooks/useLevelInfoMap';
import { useUser } from '@/hooks/useUser';
import { useClub } from '@/hooks/useClub';
import { getKoreaDate } from '@/lib/date';
import { getLevelNameFromCode } from '@/lib/level-info';
import { formatCurrentUserNameWithCoins } from '@/lib/player-display';
import { getSupabaseClient } from '@/lib/supabase';
import { inferScheduleSource } from '@/lib/match-schedule-source';

interface MatchSchedule {
  id: string;
  generated_match_id: number | null;
  schedule_source: string | null;
  match_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  max_participants: number;
  current_participants: number;
  status: string;
  description: string | null;
}

interface MatchParticipant {
  id: string;
  match_schedule_id: string;
  user_id: string;
  status: string;
  registered_at: string;
}

interface UserMatchInfo {
  schedule: MatchSchedule;
  participation: MatchParticipant | null;
  isRegistered: boolean;
  isWaitlisted?: boolean;
  waitlistPosition?: number;
  actualParticipantCount: number;
  participants: Array<{
    id: string;
    user_id: string;
    username: string | null;
    full_name: string | null;
    skill_level: string | null;
    status: string;
    registered_at?: string;
  }>;
}

function formatMatchDate(value: string | null, options: Intl.DateTimeFormatOptions) {
  return value ? new Date(value).toLocaleDateString('ko-KR', options) : '날짜 미정';
}

export default function MatchRegistrationPage() {
  const { user, profile } = useUser();
  const { clubId, loading: clubLoading } = useClub();
  const supabase = getSupabaseClient();
  const participantProfileId = profile?.id ?? null;
  const levelInfoMap = useLevelInfoMap();
  const participantKeys = useMemo(
    () => Array.from(new Set([user?.id, participantProfileId].filter((value): value is string => Boolean(value)))),
    [user?.id, participantProfileId]
  );

  const [schedules, setSchedules] = useState<MatchSchedule[]>([]);
  const [userMatches, setUserMatches] = useState<UserMatchInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState<string | null>(null);
  const [showParticipants, setShowParticipants] = useState<string | null>(null);

  const fetchSchedulesAndParticipation = useCallback(async () => {
    if (clubLoading) {
      return;
    }
    try {
      setLoading(true);
      
      const activeClubId = clubId;

      if (!activeClubId) {
        console.warn('active_club_id cookie not found');
        setSchedules([]);
        setUserMatches([]);
        setLoading(false);
        return;
      }

      const todayStr = getKoreaDate();
      let schedulesList: MatchSchedule[] = [];

      const { data: schedulesData, error: schedulesError } = await supabase
        .from('match_schedules')
        .select('id, generated_match_id, schedule_source, match_date, start_time, end_time, location, max_participants, status, description, current_participants')
        .eq('status', 'scheduled')
        .eq('club_id', activeClubId)
        .or(`match_date.gte.${todayStr},schedule_source.eq.tournament,description.ilike.%[대회 경기]%`)
        .is('generated_match_id', null)
        .order('match_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(100);

      if (schedulesError) {
        console.error('경기 일정 조회 오류:', schedulesError);
        setSchedules([]);
        setUserMatches([]);
        return;
      }

      const filteredSchedules: MatchSchedule[] = (schedulesData || [])
        .filter((schedule) => {
          const description = schedule.description || '';
          return schedule.generated_match_id == null
            && inferScheduleSource(schedule as any) !== 'generated'
            && !description.includes('자동 배정된 경기');
        })
        .map((schedule) => ({
          ...schedule,
          status: schedule.status || 'scheduled',
        }));
        
      let recurringCount = 0;
      schedulesList = filteredSchedules.filter((schedule) => {
        if (!schedule.match_date) {
          return false;
        }

        const source = inferScheduleSource(schedule as any);

        if (source === 'tournament') {
          return true; // 대회 경기는 항상 표시
        }

        if (source === 'recurring') {
          if (schedule.match_date >= todayStr) {
            if (recurringCount < 10) {
              recurringCount++;
              return true; // 정기 모임은 오늘 이후 10개 표시
            }
          }
        }

        return false;
      });

      setSchedules(schedulesList);

      if (schedulesList.length === 0) {
        setUserMatches([]);
        return;
      }

      const scheduleIds = schedulesList.map((schedule) => schedule.id);

      const participationsRes = participantKeys.length > 0
        ? await supabase
            .from('match_participants')
            .select('id, match_schedule_id, user_id, status, registered_at')
            .in('user_id', participantKeys)
            .in('match_schedule_id', scheduleIds)
        : { data: [], error: null };

      const participantsRes = await supabase
        .from('match_participants')
        .select('id, user_id, status, registered_at, match_schedule_id')
        .in('match_schedule_id', scheduleIds)
        .in('status', ['registered', 'waitlisted']);

      if (participationsRes.error) {
        console.error('참가 정보 조회 오류:', participationsRes.error);
      }

      if (participantsRes.error) {
        console.error('참가자 목록 조회 오류:', participantsRes.error);
      }

      const participationsData = (participationsRes.data || []) as MatchParticipant[];
      const participantsAll = (participantsRes.data || []) as Array<{
        id: string;
        user_id: string;
        status: string;
        registered_at: string;
        match_schedule_id: string;
      }>;

      const uniqueUserIds = Array.from(new Set(participantsAll.map((participant) => participant.user_id).filter(Boolean)));
      let profilesById: Record<string, { username?: string; full_name?: string; skill_level?: string | null }> = {};

      if (uniqueUserIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, user_id, username, full_name, skill_level')
          .or(uniqueUserIds.map((id) => `id.eq.${id},user_id.eq.${id}`).join(','));

        if (profilesError) {
          console.error('프로필 조회 오류:', profilesError);
        } else {
          profilesById = (profilesData || []).reduce((acc: Record<string, any>, row: any) => {
            const info = {
              username: row.username,
              full_name: row.full_name,
              skill_level: row.skill_level ?? null,
            };

            if (row.id) acc[row.id] = info;
            if (row.user_id) acc[row.user_id] = info;
            return acc;
          }, {});
        }
      }

      const participantsBySchedule = participantsAll.reduce((acc: Record<string, any[]>, participant) => {
        const key = participant.match_schedule_id;
        const profileInfo = profilesById[participant.user_id] || {};
        const formattedParticipant = {
          id: participant.id,
          user_id: participant.user_id,
          username: profileInfo.username || null,
          full_name: profileInfo.full_name || null,
          skill_level: profileInfo.skill_level ?? null,
          status: participant.status,
          registered_at: participant.registered_at,
        };

        if (!acc[key]) acc[key] = [];
        acc[key].push(formattedParticipant);
        return acc;
      }, {});

      const nextUserMatches = schedulesList.map((schedule) => {
        const participation =
          participationsData.find((item) => item.match_schedule_id === schedule.id && item.status === 'registered') ||
          participationsData.find((item) => item.match_schedule_id === schedule.id && item.status === 'waitlisted') ||
          participationsData.find((item) => item.match_schedule_id === schedule.id) ||
          null;
        const allParticipantsForSchedule = participantsBySchedule[schedule.id] || [];
        
        const registeredParticipants = allParticipantsForSchedule
          .filter(p => p.status === 'registered')
          .sort((a, b) => {
            const nameA = a.full_name || a.username || '';
            const nameB = b.full_name || b.username || '';
            return nameA.localeCompare(nameB, 'ko');
          });
        const waitlistedParticipants = allParticipantsForSchedule
          .filter(p => p.status === 'waitlisted')
          .sort((a, b) => new Date(a.registered_at).getTime() - new Date(b.registered_at).getTime());

        let waitlistPosition = 0;
        if (participation?.status === 'waitlisted') {
          waitlistPosition = waitlistedParticipants.findIndex(p => p.user_id === participation.user_id) + 1;
        }

        return {
          schedule,
          participation,
          isRegistered: participation?.status === 'registered',
          isWaitlisted: participation?.status === 'waitlisted',
          waitlistPosition,
          actualParticipantCount: registeredParticipants.length,
          participants: [
            ...registeredParticipants,
            ...waitlistedParticipants
          ],
        };
      });

      setUserMatches(nextUserMatches);
    } catch (error) {
      console.error('데이터 조회 중 오류:', error);
      setSchedules([]);
      setUserMatches([]);
    } finally {
      setLoading(false);
    }
  }, [participantKeys, supabase, clubId, clubLoading]);

  const registerForMatch = async (scheduleId: string, isWaitlist: boolean = false) => {
    if (!user) return;

    if (participantKeys.length === 0) {
      alert('프로필 정보가 없습니다. 먼저 프로필 연결 상태를 확인해주세요.');
      return;
    }

    try {
      setRegistering(scheduleId);

      const { data: existingParticipations, error: checkError } = await supabase
        .from('match_participants')
        .select('id, user_id, status, registered_at')
        .eq('match_schedule_id', scheduleId)
        .in('user_id', participantKeys);

      if (checkError) {
        console.error('참가 확인 오류:', checkError);
        alert('참가 확인 중 오류가 발생했습니다.');
        return;
      }

      const existingParticipation =
        (existingParticipations || []).find((item) => item.status === 'registered') ||
        (existingParticipations || []).find((item) => item.status === 'waitlisted') ||
        (existingParticipations || [])[0] ||
        null;

      if (existingParticipation?.status === 'registered') {
        alert('이미 이 경기에 참가 신청하셨습니다.');
        return;
      }
      
      if (existingParticipation?.status === 'waitlisted') {
        alert('이미 이 경기에 대기 신청하셨습니다.');
        return;
      }

      const targetStatus = isWaitlist ? 'waitlisted' : 'registered';

      if (existingParticipation?.status === 'cancelled' || existingParticipation?.status === 'absent') {
        const { error: updateError } = await supabase
          .from('match_participants')
          .update({ status: targetStatus, registered_at: new Date().toISOString() })
          .eq('id', existingParticipation.id);

        if (updateError) {
          console.error('참가 상태 변경 오류:', updateError);
          alert('신청 중 오류가 발생했습니다.');
          return;
        }
      } else {
        let insertError: { message?: string } | null = null;
        let insertedWithKey: string | null = null;

        for (const participantKey of participantKeys) {
          const { error } = await supabase
            .from('match_participants')
            .insert({
              match_schedule_id: scheduleId,
              user_id: participantKey,
              status: targetStatus,
            });

          if (!error) {
            insertedWithKey = participantKey;
            insertError = null;
            break;
          }

          insertError = error;

          if (error.code === '23505') {
            const { error: restoreError } = await supabase
              .from('match_participants')
              .update({ status: targetStatus, registered_at: new Date().toISOString() })
              .eq('match_schedule_id', scheduleId)
              .eq('user_id', participantKey);

            if (!restoreError) {
              insertedWithKey = participantKey;
              insertError = null;
              break;
            }

            insertError = restoreError;
          }
        }

        if (insertError || !insertedWithKey) {
          console.error('신청 오류:', insertError);
          alert(`신청 중 오류가 발생했습니다: ${insertError?.message || '알 수 없는 오류'}`);
          return;
        }
      }

      setUserMatches((previous) =>
        previous.map((matchInfo) => {
          if (matchInfo.schedule.id !== scheduleId || matchInfo.isRegistered || matchInfo.isWaitlisted) {
            return matchInfo;
          }

          const tempParticipantId = `temp-${participantKeys[0]}-${Date.now()}`;
          return {
            ...matchInfo,
            isRegistered: !isWaitlist,
            isWaitlisted: isWaitlist,
            waitlistPosition: isWaitlist ? (matchInfo.participants.filter(p => p.status === 'waitlisted').length + 1) : 0,
            participation: {
              id: tempParticipantId,
              match_schedule_id: scheduleId,
              user_id: participantKeys[0],
              status: targetStatus,
              registered_at: new Date().toISOString(),
            },
            actualParticipantCount: isWaitlist ? matchInfo.actualParticipantCount : matchInfo.actualParticipantCount + 1,
            participants: (() => {
              const newParticipant = {
                id: tempParticipantId,
                user_id: participantKeys[0],
                username: profile?.username || '',
                full_name: profile?.full_name || '',
                skill_level: profile?.skill_level || null,
                status: targetStatus,
              };
              const updated = [...matchInfo.participants, newParticipant];
              const registered = updated
                .filter((p) => p.status === 'registered')
                .sort((a, b) => {
                  const nameA = a.full_name || a.username || '';
                  const nameB = b.full_name || b.username || '';
                  return nameA.localeCompare(nameB, 'ko');
                });
              const waitlisted = updated.filter((p) => p.status === 'waitlisted');
              return [...registered, ...waitlisted];
            })(),
          };
        })
      );

      setTimeout(fetchSchedulesAndParticipation, 300);
      alert(isWaitlist ? '대기 신청이 완료되었습니다.' : '참가 신청이 완료되었습니다.');
    } catch (error) {
      console.error('신청 중 오류:', error);
      alert('신청 중 오류가 발생했습니다.');
    } finally {
      setRegistering(null);
    }
  };

  const cancelRegistration = async (scheduleId: string) => {
    if (!user || participantKeys.length === 0 || !await confirm('참가를 취소하시겠습니까?')) {
      return;
    }

    try {
      setRegistering(scheduleId);

      const { data: existingParticipations, error: lookupError } = await supabase
        .from('match_participants')
        .select('id, user_id, status')
        .eq('match_schedule_id', scheduleId)
        .in('user_id', participantKeys);

      if (lookupError) {
        console.error('참가 취소 대상 조회 오류:', lookupError);
        alert('참가 취소 대상을 찾는 중 오류가 발생했습니다.');
        return;
      }

      const targetParticipation =
        (existingParticipations || []).find((item) => item.status === 'registered') ||
        (existingParticipations || [])[0] ||
        null;

      if (!targetParticipation) {
        alert('취소할 참가 신청 정보를 찾지 못했습니다.');
        return;
      }

      const { error } = await supabase
        .from('match_participants')
        .update({ status: 'cancelled' })
        .eq('id', targetParticipation.id);

      if (error) {
        console.error('참가 취소 오류:', error);
        alert('참가 취소 중 오류가 발생했습니다.');
        return;
      }

      setUserMatches((previous) =>
        previous.map((matchInfo) => {
          if (matchInfo.schedule.id !== scheduleId || !matchInfo.isRegistered) {
            return matchInfo;
          }

          return {
            ...matchInfo,
            isRegistered: false,
            participation: matchInfo.participation
              ? { ...matchInfo.participation, status: 'cancelled' }
              : null,
            actualParticipantCount: Math.max(matchInfo.actualParticipantCount - 1, 0),
            participants: matchInfo.participants.filter((participant) => !participantKeys.includes(participant.user_id)),
          };
        })
      );

      setTimeout(fetchSchedulesAndParticipation, 300);
      alert('참가가 취소되었습니다.');
    } catch (error) {
      console.error('참가 취소 중 오류:', error);
      alert('참가 취소 중 오류가 발생했습니다.');
    } finally {
      setRegistering(null);
    }
  };

  useEffect(() => {
    fetchSchedulesAndParticipation();
  }, [fetchSchedulesAndParticipation]);

  useEffect(() => {
    const onFocus = () => {
      fetchSchedulesAndParticipation();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchSchedulesAndParticipation();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchSchedulesAndParticipation]);

  useEffect(() => {
    const channel = supabase
      .channel('realtime-match-registration')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_participants' }, fetchSchedulesAndParticipation)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_schedules' }, fetchSchedulesAndParticipation)
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // noop
      }
    };
  }, [fetchSchedulesAndParticipation, supabase]);

  const myMatches = userMatches.filter((match) => match.isRegistered || match.isWaitlisted);

  return (
    <RequireAuth>
      <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
          <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
            <div className="relative z-10 flex items-center justify-between px-1">
              <div className="space-y-0.5 pl-2">
                <h1 className="text-xl font-bold tracking-tight">경기 참가 신청</h1>
                <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">예정 경기 참가 여부를 등록합니다.</p>
              </div>
              <Link href="/dashboard">
                <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                  <ArrowLeft className="h-3.5 w-3.5" />
                  홈
                </Button>
              </Link>
            </div>
            
            <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-white/10 text-[11px]">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-100">
                {formatCurrentUserNameWithCoins(profile?.full_name || profile?.username || '회원', profile?.coin_balance)}님
              </span>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-100">
                레벨 {profile?.skill_level_name || getLevelNameFromCode(levelInfoMap, profile?.skill_level, profile?.skill_level || '미지정')}
              </span>
            </div>
          </section>

          <section className="rounded-[24px] bg-white px-3 py-3 sm:px-4 sm:py-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">예정 일정</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">참가 신청 목록</h2>
              </div>
              <Link href="/dashboard" className="inline-flex items-center gap-1 text-sm font-medium text-slate-700">
                대시보드
                <ArrowRight className="size-4" />
              </Link>
            </div>

            {loading ? (
              <div className="py-8 text-center text-sm text-slate-500">잠시만 기다려 주세요.</div>
            ) : schedules.length === 0 ? (
              <div className="mt-4 rounded-[20px] bg-slate-50 px-4 py-5 text-sm text-slate-600 text-center font-medium">
                참가 신청을 준비 중입니다. 잠시만 기다려 주세요.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {userMatches.map((matchInfo) => {
                  const isFull = matchInfo.actualParticipantCount >= matchInfo.schedule.max_participants;
                  const participantsVisible = showParticipants === matchInfo.schedule.id;

                  return (
                    <article key={matchInfo.schedule.id} className="rounded-[22px] border border-slate-200 bg-slate-50 p-4">
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-base font-semibold text-slate-900">
                              {formatMatchDate(matchInfo.schedule.match_date, {
                                month: 'long',
                                day: 'numeric',
                                weekday: 'short',
                              })}
                            </p>
                            {inferScheduleSource(matchInfo.schedule as any) === 'tournament' && (
                              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                                대회 경기
                              </span>
                            )}
                          </div>
                          <div className="mt-2 space-y-1.5 text-sm text-slate-600">
                            <div className="flex items-center gap-2">
                              <CalendarDays className="size-4 text-slate-400" />
                              <span>{matchInfo.schedule.start_time || '시간 미정'} - {matchInfo.schedule.end_time || '시간 미정'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <MapPin className="size-4 text-slate-400" />
                              <span>{matchInfo.schedule.location || '장소 미정'}</span>
                            </div>
                          </div>
                        </div>

                        {matchInfo.schedule.description && (
                          <p className="text-sm leading-6 text-slate-600">
                            {matchInfo.schedule.description.replace(/\s*-\s*정기모임\s*\([^)]+\)/, '')}
                          </p>
                        )}

                        <div className="flex items-center justify-between rounded-[18px] bg-white px-3 py-3">
                          <div className="flex items-center gap-2 text-sm text-slate-700">
                            <Users className="size-4 text-slate-400" />
                            <span>
                              {matchInfo.actualParticipantCount} / {matchInfo.schedule.max_participants}명
                            </span>
                          </div>
                          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${isFull ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {isFull ? '마감' : '신청 가능'}
                          </span>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            onClick={() => setShowParticipants(matchInfo.schedule.id)}
                            variant="outline"
                            className="h-10 flex-1 rounded-full border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                          >
                            참가자 {matchInfo.actualParticipantCount}명
                          </Button>

                          {matchInfo.isRegistered ? (
                            <Button
                              onClick={() => cancelRegistration(matchInfo.schedule.id)}
                              disabled={registering === matchInfo.schedule.id}
                              variant="outline"
                              className="h-10 flex-1 rounded-full border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
                            >
                              {registering === matchInfo.schedule.id ? '처리 중...' : '참가 취소'}
                            </Button>
                          ) : matchInfo.isWaitlisted ? (
                            <Button
                              onClick={() => cancelRegistration(matchInfo.schedule.id)}
                              disabled={registering === matchInfo.schedule.id}
                              variant="outline"
                              className="relative h-10 flex-1 rounded-full border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                            >
                              <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[11px] font-bold text-white shadow-sm ring-2 ring-white">
                                {matchInfo.waitlistPosition}
                              </span>
                              {registering === matchInfo.schedule.id ? '처리 중...' : '대기 취소'}
                            </Button>
                          ) : (
                            <Button
                              onClick={() => registerForMatch(matchInfo.schedule.id, isFull)}
                              disabled={registering === matchInfo.schedule.id}
                              className={`h-10 flex-1 rounded-full text-white ${isFull ? 'bg-slate-500 hover:bg-slate-600' : 'bg-slate-950 hover:bg-slate-800'}`}
                            >
                              {registering === matchInfo.schedule.id ? '신청 중...' : isFull ? '대기 신청' : '참가 신청'}
                            </Button>
                          )}
                        </div>

                        {matchInfo.participation?.registered_at && matchInfo.isRegistered && (
                          <p className="text-xs text-slate-500">
                            신청일시 {new Date(matchInfo.participation.registered_at).toLocaleString('ko-KR')}
                          </p>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {myMatches.length > 0 && (
            <section className="rounded-[24px] bg-white px-4 py-4 shadow-sm">
              <p className="text-xs text-slate-500">내 현황</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">신청한 경기</h2>
              <div className="mt-4 space-y-3">
                {myMatches.map((matchInfo) => (
                  <div key={`my-${matchInfo.schedule.id}`} className="rounded-[20px] bg-slate-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {formatMatchDate(matchInfo.schedule.match_date, {
                            month: 'long',
                            day: 'numeric',
                            weekday: 'short',
                          })}
                        </p>
                        <p className="mt-1 text-sm text-slate-600">{matchInfo.schedule.start_time || '시간 미정'} · {matchInfo.schedule.location || '장소 미정'}</p>
                      </div>
                      {matchInfo.isWaitlisted ? (
                        <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                          대기 {matchInfo.waitlistPosition}번
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                          참가 확정
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {showParticipants && (() => {
            const activeMatch = userMatches.find((matchInfo) => matchInfo.schedule.id === showParticipants);

            if (!activeMatch) {
              return null;
            }

            return (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                role="dialog"
                aria-modal="true"
                aria-labelledby="participant-modal-title"
                onClick={() => setShowParticipants(null)}
              >
                <div
                  className="w-full max-w-4xl rounded-[28px] bg-white p-4 shadow-2xl"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-500">참가자 목록</p>
                      <h3 id="participant-modal-title" className="mt-1 text-lg font-semibold text-slate-900">
                        {formatMatchDate(activeMatch.schedule.match_date, {
                          month: 'long',
                          day: 'numeric',
                          weekday: 'short',
                        })} · {activeMatch.schedule.start_time || '시간 미정'}
                      </h3>
                      {(() => {
                        const waitlistCount = activeMatch.participants.filter((p) => p.status === 'waitlisted').length;
                        return (
                          <p className="mt-1 text-sm text-slate-600">
                            {activeMatch.schedule.location || '장소 미정'} · {activeMatch.actualParticipantCount} / {activeMatch.schedule.max_participants}명
                            {waitlistCount > 0 && ` · 대기 ${waitlistCount}명`}
                          </p>
                        );
                      })()}
                    </div>

                    <Button
                      onClick={() => setShowParticipants(null)}
                      variant="outline"
                      className="h-9 rounded-full border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      닫기
                    </Button>
                  </div>

                  <div className="mt-4 max-h-[70vh] overflow-y-auto">
                    {activeMatch.participants.length > 0 ? (
                      <div className="grid grid-cols-4 gap-2">
                        {activeMatch.participants.map((participant, index) => {
                          const isWaitlisted = participant.status === 'waitlisted';
                          const waitlistNumber = isWaitlisted 
                            ? activeMatch.participants.filter(p => p.status === 'waitlisted').findIndex(p => p.id === participant.id) + 1
                            : 0;

                          return (
                            <div
                              key={participant.id || `${participant.user_id}-${index}`}
                              className={`relative rounded-2xl border px-3 py-3 text-sm flex flex-col items-center justify-center gap-1 text-center ${isWaitlisted ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-slate-50 text-slate-700'}`}
                            >
                              {isWaitlisted && (
                                <span className="absolute -top-2 -right-2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-500 px-1.5 text-[11px] font-bold text-white shadow-sm ring-2 ring-white">
                                  대기 {waitlistNumber}
                                </span>
                              )}
                              <span className={`font-medium ${isWaitlisted ? 'text-blue-900' : 'text-slate-900'}`}>
                                {participant.full_name || participant.username || '이름 없음'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                        아직 참가자가 없습니다.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </RequireAuth>
  );
}

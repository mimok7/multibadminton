'use client';

import { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { getProfileByUserId } from '@/lib/auth';
import { formatNameWithCoins } from '@/lib/player-display';
import { formatKSTDate, formatTimeHHmm } from '@/lib/date';
import { useClub } from '@/hooks/useClub';
import type { Database } from '@/types/supabase';

interface MatchSchedule {
  id: string;
  match_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  max_participants: number;
  current_participants: number;
  status: string;
  description?: string;
}

interface Participant {
  id: string;
  user_id: string;
  status: string;
  registered_at: string;
  profile?: {
    username?: string | null;
    full_name?: string | null;
    skill_level?: string | null;
    coin_balance?: number | null;
  };
}

type MatchParticipantRow = Database['public']['Tables']['match_participants']['Row'];

interface MatchRegistrationProps {
  schedule: MatchSchedule;
  currentUserId?: string;
  onRegistrationChange?: () => void;
}

export default function MatchRegistration({ 
  schedule, 
  currentUserId, 
  onRegistrationChange 
}: MatchRegistrationProps) {
  const supabase = getSupabaseClient();
  const { clubId } = useClub();
  const [resolvedParticipantId, setResolvedParticipantId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(false);
  const [userRegistration, setUserRegistration] = useState<Participant | null>(null);
  const formatMatchDate = (value: string | null) =>
    value ? formatKSTDate(value) : '날짜 미정';

  // 참가자 목록 조회
  const fetchParticipants = async () => {
    try {
      console.log('👥 참가자 목록 조회:', schedule.id);

      let participantId = currentUserId ?? null;
      if (currentUserId) {
        const profile = await getProfileByUserId(supabase, currentUserId);
        participantId = profile?.id ?? currentUserId;
        setResolvedParticipantId(participantId);
      } else {
        setResolvedParticipantId(null);
      }

      const { data, error } = await supabase
        .from('match_participants')
        .select('id, user_id, status, registered_at, match_schedule_id')
        .eq('match_schedule_id', schedule.id)
        .eq('status', 'registered')
        .order('registered_at', { ascending: true });

      if (error) {
        console.error('❌ 참가자 조회 오류:', error);
        return;
      }

      const participantRows = (data || []) as Pick<
        MatchParticipantRow,
        'id' | 'user_id' | 'status' | 'registered_at' | 'match_schedule_id'
      >[];

      const userIds = Array.from(new Set(participantRows.map((participant) => participant.user_id)));
      let profileMap = new Map<string, Participant['profile']>();

      if (userIds.length > 0) {
        const { data: profiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, user_id, username, full_name, skill_level, coin_balance')
          .or(
            userIds
              .map((userId) => `id.eq.${userId},user_id.eq.${userId}`)
              .join(',')
          );

        if (profilesError) {
          console.error('❌ 프로필 조회 오류:', profilesError);
        } else {
          profileMap = new Map(
            (profiles || [])
              .flatMap((profile) => {
                const value = {
                  username: profile.username || undefined,
                  full_name: profile.full_name || undefined,
                  skill_level: profile.skill_level || undefined,
                  coin_balance: profile.coin_balance ?? undefined,
                };
                return [profile.id, profile.user_id]
                  .filter((key): key is string => typeof key === 'string' && key.length > 0)
                  .map((key) => [key, value] as const);
              })
          );
        }
      }

      const formattedParticipants: Participant[] = participantRows.map((participant) => ({
        id: participant.id,
        user_id: participant.user_id,
        status: participant.status,
        registered_at: participant.registered_at,
        profile: profileMap.get(participant.user_id),
      }));

      console.log('✅ 참가자 조회 완료:', formattedParticipants.length, '명');
      setParticipants(formattedParticipants);

      // 현재 사용자의 등록 상태 확인
      if (participantId) {
        const userParticipant = formattedParticipants.find((participant) => participant.user_id === participantId);
        setUserRegistration(userParticipant || null);
      }
    } catch (error) {
      console.error('❌ 참가자 조회 중 오류:', error);
    }
  };

  useEffect(() => {
    fetchParticipants();
  }, [schedule.id, currentUserId]);

  // 경기 참가 신청
  const handleRegister = async () => {
    const participantId = resolvedParticipantId ?? currentUserId;

    if (!participantId) {
      alert('로그인이 필요합니다.');
      return;
    }

    if (schedule.current_participants >= schedule.max_participants) {
      alert('참가 인원이 마감되었습니다.');
      return;
    }

    if (schedule.status !== 'scheduled') {
      alert('참가 신청이 불가능한 경기입니다.');
      return;
    }

    try {
      setLoading(true);
      console.log('📝 경기 참가 신청:', schedule.id, currentUserId);

      // 1. 프로필 존재 여부 확인
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', participantId)
        .maybeSingle();

      if (profileError && profileError.code !== 'PGRST116') {
        console.error('❌ 프로필 확인 오류:', profileError);
      }

      // 프로필이 없으면 에러 메시지 (회원가입 페이지로 유도)
      if (!profileData) {
        alert('프로필 정보가 없습니다. 프로필 설정 페이지에서 정보를 등록해주세요.');
        window.location.href = '/profile';
        return;
      }

      // 2. 먼저 이미 등록되어 있는지 확인
      const { data: existingData, error: checkError } = await supabase
        .from('match_participants')
        .select('id')
        .eq('match_schedule_id', schedule.id)
        .eq('user_id', participantId)
        .eq('status', 'registered')
        .maybeSingle();

      if (checkError && checkError.code !== 'PGRST116') {
        console.error('❌ 등록 확인 오류:', checkError);
        alert('등록 확인 중 오류가 발생했습니다.');
        return;
      }

      if (existingData) {
        alert('이미 참가 신청하셨습니다.');
        return;
      }

      // 3. 등록 진행
      const activeClubId = clubId || '';

      const { error } = await supabase
        .from('match_participants')
        .insert([{
          match_schedule_id: schedule.id,
          user_id: participantId,
          status: 'registered',
          club_id: activeClubId
        }]);

      if (error) {
        console.error('❌ 참가 신청 오류:', error);
        if (error.code === '23505') { // unique constraint violation
          alert('이미 참가 신청하셨습니다.');
        } else if (error.code === '23503') { // foreign key violation
          alert('프로필 정보가 올바르지 않습니다. 프로필 페이지에서 정보를 확인해주세요.');
        } else {
          alert('참가 신청 중 오류가 발생했습니다.');
        }
        return;
      }

      console.log('✅ 참가 신청 완료');
      alert('참가 신청이 완료되었습니다.');
      
      await fetchParticipants();
      onRegistrationChange?.();
    } catch (error) {
      console.error('❌ 참가 신청 중 오류:', error);
      alert('참가 신청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 경기 참가 취소
  const handleCancel = async () => {
    if (!userRegistration) return;

    if (!await confirm('참가 신청을 취소하시겠습니까?')) return;

    try {
      setLoading(true);
      console.log('❌ 경기 참가 취소:', userRegistration.id);

      const { error } = await supabase
        .from('match_participants')
        .delete()
        .eq('id', userRegistration.id);

      if (error) {
        console.error('❌ 참가 취소 오류:', error);
        alert('참가 취소 중 오류가 발생했습니다.');
        return;
      }

      console.log('✅ 참가 취소 완료');
      alert('참가 신청이 취소되었습니다.');
      
      await fetchParticipants();
      onRegistrationChange?.();
    } catch (error) {
      console.error('❌ 참가 취소 중 오류:', error);
      alert('참가 취소 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 날짜가 지났는지 확인
  const isPastDate = schedule.match_date ? new Date(schedule.match_date) < new Date() : false;

  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">
            {formatMatchDate(schedule.match_date)}
          </h3>
          <p className="text-gray-600 mt-1">
            {formatTimeHHmm(schedule.start_time)} - {formatTimeHHmm(schedule.end_time)}
          </p>
          <p className="text-gray-600">
            📍 {schedule.location}
          </p>
        </div>
        
        <div className="text-right">
          <div className="text-sm text-gray-500">참가자</div>
          <div className="text-lg font-semibold">
            <span className={participants.length >= schedule.max_participants ? 'text-red-600' : 'text-blue-600'}>
              {participants.length}
            </span>
            <span className="text-gray-400">/{schedule.max_participants}</span>
          </div>
          
          {/* 참가율 바 */}
          <div className="w-24 bg-gray-200 rounded-full h-2 mt-2">
            <div 
              className={`h-2 rounded-full ${
                participants.length >= schedule.max_participants ? 'bg-red-500' : 'bg-blue-500'
              }`}
              style={{ 
                width: `${Math.min(100, (participants.length / schedule.max_participants) * 100)}%` 
              }}
            />
          </div>
        </div>
      </div>

      {schedule.description && (
        <div className="bg-gray-50 rounded p-3 mb-4">
          <p className="text-sm text-gray-700">{schedule.description}</p>
        </div>
      )}

      {/* 참가 신청/취소 버튼 */}
      {currentUserId && schedule.status === 'scheduled' && !isPastDate && (
        <div className="mb-4">
          {userRegistration ? (
            <button
              onClick={handleCancel}
              disabled={loading}
              className="bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white px-6 py-2 rounded font-medium w-full"
            >
              {loading ? '처리중...' : '참가 취소'}
            </button>
          ) : (
            <button
              onClick={handleRegister}
              disabled={loading || participants.length >= schedule.max_participants}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-6 py-2 rounded font-medium w-full"
            >
              {loading ? '처리중...' : 
               participants.length >= schedule.max_participants ? '참가 마감' : '참가 신청'}
            </button>
          )}
        </div>
      )}

      {/* 상태 메시지 */}
      {isPastDate && (
        <div className="bg-gray-100 text-gray-600 p-3 rounded mb-4 text-center">
          지난 경기입니다.
        </div>
      )}

      {schedule.status === 'cancelled' && (
        <div className="bg-red-100 text-red-600 p-3 rounded mb-4 text-center">
          취소된 경기입니다.
        </div>
      )}

      {schedule.status === 'completed' && (
        <div className="bg-green-100 text-green-600 p-3 rounded mb-4 text-center">
          완료된 경기입니다.
        </div>
      )}

      {/* 참가자 목록 */}
      {participants.length > 0 && (
        <div>
          <h4 className="font-semibold text-gray-900 mb-3">참가자 목록</h4>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {participants.map((participant, index) => (
              <div key={participant.id} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-500 w-6">
                    {index + 1}.
                  </span>
                  <span className="font-medium">
                    {formatNameWithCoins(
                      participant.profile?.full_name || participant.profile?.username || '이름 없음',
                      participant.profile?.coin_balance,
                    )}
                  </span>
                  {participant.profile?.skill_level && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {participant.profile.skill_level.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500">
                  {formatKSTDate(participant.registered_at)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {participants.length === 0 && (
        <div className="text-center text-gray-500 py-4">
          아직 참가자가 없습니다.
        </div>
      )}
    </div>
  );
}

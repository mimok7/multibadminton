'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useUser } from '@/hooks/useUser';
import { useClub } from '@/hooks/useClub';
import { getProfileByUserId } from '@/lib/auth';
import { getSupabaseClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Search, Camera, User, X, ArrowLeft } from 'lucide-react';
import { AvatarCropModal } from '@/components/profile/AvatarCropModal';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SKILL_LEVEL_GROUP_CODES,
  getSkillLevelGroupCode,
  type SkillLevelGroupCode,
} from '@/lib/skill-levels';
import { formatCurrentUserNameWithCoins } from '@/lib/player-display';
import { useLevelInfoMap } from '@/hooks/useLevelInfoMap';
import { getLevelNameFromCode } from '@/lib/level-info';

const formSchema = z.object({
  username: z.string().min(2, { message: '닉네임은 2자 이상이어야 합니다.' }),
  gender: z.string().nullable().or(z.literal('')),
});

export default function ProfilePage() {
  const { user, profile, loading: userLoading } = useUser();
  const { clubId, loading: clubLoading, clubMember: clubMemberInfo } = useClub();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const [members, setMembers] = useState<any[]>([]);
  const [myVotes, setMyVotes] = useState<Record<string, string>>({});
  const [myLatestProfile, setMyLatestProfile] = useState<any>(null);


  
  // 비밀번호 변경 관련 상태
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [draftVotes, setDraftVotes] = useState<Record<string, string>>({});
  const [modifiedVotes, setModifiedVotes] = useState<Record<string, string>>({});
  const [ratingSettings, setRatingSettings] = useState<{ start_date: string | null; end_date: string | null } | null>(null);
  const [allVotes, setAllVotes] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [allLevels, setAllLevels] = useState<any[]>([]);
  const [isSavingRatings, setIsSavingRatings] = useState(false);
  const [isCoinEnabled, setIsCoinEnabled] = useState(true);
  const supabase = getSupabaseClient();

  // 프로필 사진 업로드 관련 상태
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [isCropOpen, setIsCropOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 회원 사진 확대 팝업을 위한 상태
  const [activePhotoUrl, setActivePhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setAvatarUrl(profile.avatar_url || null);
    }
  }, [profile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAvatarFile(e.target.files[0]);
      setIsCropOpen(true);
    }
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    if (!user) return;
    setIsCropOpen(false);
    setIsUploadingAvatar(true);

    try {
      // FormData로 서버 API에 파일 전송 (service_role 권한으로 업로드)
      const formData = new FormData();
      const file = new File([croppedBlob], 'avatar.jpg', { type: 'image/jpeg' });
      formData.append('file', file);
      formData.append('userId', user.id);

      const response = await fetch('/api/upload-avatar', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || '업로드에 실패했습니다.');
      }

      const publicUrl = result.publicUrl;

      setAvatarUrl(publicUrl);
      alert('프로필 사진이 변경되었습니다.');
      
      // 상태 동기화를 위해 프로필 데이터 재조회
      await loadRatingData(user.id, clubId);
    } catch (err: any) {
      console.error('Avatar upload error:', err);
      alert(`프로필 사진 업로드 실패: ${err.message || '알 수 없는 오류'}`);
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setAvatarFile(null);
    }
  };
  const levelInfoMap = useLevelInfoMap();
  const targetProfile = myLatestProfile || profile;
  const displayName = targetProfile?.full_name || targetProfile?.username || '회원';
  const levelLabel = targetProfile?.skill_level_name || getLevelNameFromCode(levelInfoMap, targetProfile?.skill_level, targetProfile?.skill_level || '미지정');
  const levelOptions = SKILL_LEVEL_GROUP_CODES.map((code) => ({
    code,
    name: getLevelNameFromCode(levelInfoMap, code, code) || code,
  }));
  const roleLabel = clubMemberInfo?.role === 'owner' ? '소유자' :
                    clubMemberInfo?.role === 'admin' ? '관리자' :
                    clubMemberInfo?.role === 'manager' ? '매니저' : '일반 회원';
  const genderLabel =
    targetProfile?.gender === 'male' || targetProfile?.gender === 'M'
      ? '남성'
      : targetProfile?.gender === 'female' || targetProfile?.gender === 'F'
        ? '여성'
        : '미설정';

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: '',
      gender: '',
    },
  });

  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/login');
      return;
    }

    if (profile) {
      form.reset({
        username: profile.username || '',
        gender: profile.gender || '',
      });
    }
  }, [user, profile, userLoading, router, form]);

  const loadRatingData = async (currentUserId: string, targetClubId: string | null) => {
    setLoadingData(true);
    let resolvedMembers: any[] = [];
    
    try {
      const myProf = await getProfileByUserId(supabase, currentUserId);
      if (myProf) {
        setMyLatestProfile(myProf);
      }
    } catch (err) {
      console.error('Error loading latest profile:', err);
    }

    try {
      let profilesData: any[] = [];
      if (targetClubId) {
        const res = await fetch('/api/user/club-members');
        if (res.ok) {
          const json = await res.json();
          profilesData = json.members || [];
        } else {
          console.error('Error fetching club members API:', await res.text());
        }
      } else {
        profilesData = [];
      }
      const collator = new Intl.Collator('ko');
      resolvedMembers = (profilesData || []).slice().sort((a: any, b: any) => {
        const aName = a.full_name || a.username || a.email || '';
        const bName = b.full_name || b.username || b.email || '';
        return collator.compare(aName, bName);
      });
      setMembers(resolvedMembers);
    } catch (err) {
      console.error('Error loading members:', err);
    }

    try {
      const { data: levelsData } = await supabase
        .from('level_info')
        .select('code, name, score, description')
        .order('score', { ascending: false, nullsFirst: false });
      if (levelsData) {
        setAllLevels(levelsData);
      }
    } catch (err) {
      console.error('Error loading level info:', err);
    }

    try {
      let settingsQuery = (supabase as any)
        .from('member_rating_settings')
        .select('start_date, end_date');
      if (targetClubId) {
        settingsQuery = settingsQuery.eq('club_id', targetClubId);
      } else {
        settingsQuery = settingsQuery.eq('id', 1);
      }
      
      const { data: settingsData, error: settingsError } = await settingsQuery.maybeSingle();
      
      if (settingsError) {
        console.warn('API Error loading rating settings (Fallback applied):', settingsError.message);
        setRatingSettings({ start_date: null, end_date: null });
      } else if (settingsData) {
        setRatingSettings(settingsData);
      } else {
        setRatingSettings({ start_date: null, end_date: null });
      }
    } catch (err) {
      console.error('Unhandled exception loading rating settings:', err);
      setRatingSettings({ start_date: null, end_date: null });
    }

    try {
      let votesQuery = (supabase as any)
        .from('member_level_votes')
        .select('voter_id, subject_id, skill_level');
      if (targetClubId) {
        votesQuery = votesQuery.eq('club_id', targetClubId);
      }
      const { data: votesData } = await votesQuery;

      if (votesData) {
        setAllVotes(votesData);
        const userVotesMap: Record<string, string> = {};
        votesData.forEach((vote: any) => {
          if (vote.voter_id === currentUserId) {
            userVotesMap[vote.subject_id] = vote.skill_level;
          }
        });
        setMyVotes(userVotesMap);

        const initialDrafts: Record<string, string> = {};
        resolvedMembers.forEach((m: any) => {
          initialDrafts[m.id] = userVotesMap[m.id] || m.skill_level || '';
        });
        setDraftVotes(initialDrafts);
      }
    } catch (err) {
      console.error('Error loading rating votes:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const fetchCoinStatus = async () => {
    try {
      const res = await fetch('/api/coins/settings');
      const data = await res.json();
      if (res.ok) {
        setIsCoinEnabled(data.isCoinEnabled !== false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (user && !clubLoading) {
      loadRatingData(user.id, clubId);
      void fetchCoinStatus();
    }
  }, [user, clubId, clubLoading]);

  const handleDraftVote = (subjectId: string, levelCode: string) => {
    setDraftVotes((prev) => ({
      ...prev,
      [subjectId]: levelCode,
    }));

    const originalVal = myVotes[subjectId] || members.find((m) => m.id === subjectId)?.skill_level || '';
    if (levelCode === originalVal) {
      setModifiedVotes((prev) => {
        const next = { ...prev };
        delete next[subjectId];
        return next;
      });
    } else {
      setModifiedVotes((prev) => ({
        ...prev,
        [subjectId]: levelCode,
      }));
    }
  };

  const handleResetToDefault = (subjectId: string, originalLevel: string) => {
    setDraftVotes((prev) => ({
      ...prev,
      [subjectId]: originalLevel || '',
    }));

    const originalVal = myVotes[subjectId] || originalLevel || '';
    const targetVal = originalLevel || '';
    if (targetVal === originalVal) {
      setModifiedVotes((prev) => {
        const next = { ...prev };
        delete next[subjectId];
        return next;
      });
    } else {
      setModifiedVotes((prev) => ({
        ...prev,
        [subjectId]: targetVal,
      }));
    }
  };

  const saveRatings = async () => {
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    if (isSubmitted) {
      alert('이미 이번 기간의 평가를 완료하셨습니다.');
      return;
    }

    const confirmSave = await window.confirm(
      '평가를 저장하시겠습니까? 저장 후에는 이번 기간 동안 평가를 수정하거나 추가로 제출할 수 없습니다.'
    );
    if (!confirmSave) return;

    setIsSavingRatings(true);
    try {
      const promises: any[] = [];

      for (const subjectId of Object.keys(modifiedVotes)) {
        const val = modifiedVotes[subjectId];
        const oldVal = myVotes[subjectId] || '';

        if (val === '') {
          if (oldVal !== '') {
            let delQuery = (supabase as any)
              .from('member_level_votes')
              .delete()
              .eq('voter_id', user.id)
              .eq('subject_id', subjectId);
            if (clubId) {
              delQuery = delQuery.eq('club_id', clubId);
            }
            promises.push(delQuery);
          }
        } else {
          promises.push(
            (supabase as any)
              .from('member_level_votes')
              .upsert(
                {
                  voter_id: user.id,
                  subject_id: subjectId,
                  skill_level: val,
                  updated_at: new Date().toISOString(),
                  ...(clubId ? { club_id: clubId } : {}),
                },
                { onConflict: 'club_id,voter_id,subject_id' }
              )
          );
        }
      }

      if (promises.length === 0) {
        alert('변경 사항이 없습니다.');
        setIsSavingRatings(false);
        return;
      }

      const results = await Promise.all(promises);
      const failed = results.filter((r) => r.error);

      if (failed.length > 0) {
        console.error('일부 평가 저장 실패:', failed);
        alert('일부 평가가 저장되지 않았습니다. 잠시 후 다시 시도해 주세요.');
      } else {
        alert('모든 변경 사항이 성공적으로 저장되었습니다.');
        setModifiedVotes({});
      }

      await loadRatingData(user.id, clubId);
    } catch (err) {
      console.error('Error saving ratings:', err);
      alert('저장 중 알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsSavingRatings(false);
    }
  };

  const isRatingPeriodActive = () => {
    if (!ratingSettings) return false;
    if (!ratingSettings.start_date || !ratingSettings.end_date) return false;
    const now = new Date();
    const start = new Date(ratingSettings.start_date);
    const end = new Date(ratingSettings.end_date);
    return now >= start && now <= end;
  };

  const formatPeriodDate = (isoString: string | null) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  };

  const hasDraftChanges = () => {
    return Object.keys(modifiedVotes).length > 0;
  };

  const getFilteredLevelsForMember = (memberSkillLevel: string) => {
    if (!memberSkillLevel) return allLevels;
    const targetIndex = allLevels.findIndex(
      (lvl) => lvl.code.toLowerCase() === memberSkillLevel.toLowerCase()
    );
    if (targetIndex === -1) {
      return allLevels;
    }
    const startIndex = Math.max(0, targetIndex - 3);
    const endIndex = Math.min(allLevels.length - 1, targetIndex + 1);
    return allLevels.slice(startIndex, endIndex + 1);
  };

  const filteredMembers = members.filter((m) => {
    const name = (m.full_name || m.username || m.email || '').toLowerCase();
    return name.includes(searchQuery.toLowerCase());
  });

  const getFullLevelLabel = (code: string) => {
    const lvl = allLevels.find(l => l.code.toLowerCase() === code.toLowerCase());
    return lvl?.description || lvl?.name || code;
  };

  const getMemberStats = (memberId: string) => {
    const memberVotes = allVotes.filter((v) => v.subject_id === memberId);
    const totalVotes = memberVotes.length;

    if (totalVotes === 0) {
      return { totalVotes, avgScore: null, nearestLevelName: '평가 없음 (-)' };
    }

    let sumScore = 0;
    memberVotes.forEach((v) => {
      const normalizedCode = v.skill_level.toLowerCase();
      const score = levelInfoMap[normalizedCode]?.score ?? 0;
      sumScore += score;
    });

    const avgScore = sumScore / totalVotes;

    let closestCode = '';
    let minDiff = Infinity;
    allLevels.forEach((level) => {
      const normalizedOption = level.code.toLowerCase();
      const optionScore = levelInfoMap[normalizedOption]?.score ?? 0;
      const diff = Math.abs(optionScore - avgScore);
      if (diff < minDiff) {
        minDiff = diff;
        closestCode = level.code;
      }
    });

    const nearestLevelName = getLevelNameFromCode(levelInfoMap, closestCode, closestCode);
    return {
      totalVotes,
      avgScore: Number(avgScore.toFixed(1)),
      nearestLevelName,
    };
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!user) {
      alert('로그인이 필요합니다.');
      router.push('/login');
      return;
    }

    setIsSubmitting(true);

    const targetProfileId = profile?.id || myLatestProfile?.id || user.id;
    const { error } = await supabase.from('profiles').update(values).eq('id', targetProfileId);

    setIsSubmitting(false);
    if (error) {
      console.error('프로필 업데이트 오류:', error);
      alert(`프로필 업데이트 실패: ${error.message}`);
    } else {
      alert('프로필이 성공적으로 업데이트되었습니다.');
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (newPassword.length < 8) {
      setPasswordError('비밀번호는 8자 이상이어야 합니다.');
      return;
    }

    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
      setPasswordError('비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('비밀번호가 일치하지 않습니다.');
      return;
    }

    setIsChangingPassword(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setPasswordError('인증 세션이 없습니다. 다시 로그인해주세요.');
        router.replace('/login');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
        data: {
          ...(session.user.user_metadata || {}),
          must_change_password: false,
        },
      });

      if (updateError) {
        const normalized = updateError.message?.toLowerCase() ?? '';
        let errorMsg = updateError.message;
        if (normalized.includes('same password')) {
          errorMsg = '기존 비밀번호와 다른 새 비밀번호를 입력해주세요.';
        } else if (
          normalized.includes('password should be at least') ||
          normalized.includes('password is too weak') ||
          normalized.includes('weak password') ||
          normalized.includes('password')
        ) {
          errorMsg = '비밀번호는 8자 이상이며 영문, 숫자, 특수문자를 포함하는 강한 비밀번호로 입력해주세요.';
        }
        setPasswordError(errorMsg);
        return;
      }

      await supabase.auth.refreshSession();
      alert('비밀번호가 성공적으로 변경되었습니다.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('비밀번호 변경 에러:', err);
      setPasswordError('비밀번호 변경 중 오류가 발생했습니다.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  const isSubmitted = Object.keys(myVotes).length > 0;

  if (userLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-4">
        <div className="rounded-full bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          프로필을 불러오는 중입니다
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-slate-900">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-2.5 pt-0 pb-3 sm:gap-5 sm:px-5 sm:pt-0 sm:pb-5">
        <section className="relative rounded-[28px] bg-[#0f172a] px-4 py-5 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] sm:px-5 sm:py-6">
          <div className="flex flex-col sm:flex-row items-center gap-5 sm:gap-6">
            {/* 프로필 이미지 업로더 (사각 모서리 타원 모양 - rounded-[32px]) */}
            <div className="relative shrink-0">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
                className="group relative flex size-24 items-center justify-center overflow-hidden rounded-[32px] bg-slate-800 border-2 border-white/20 transition-all duration-300 hover:border-white/40 focus:outline-none"
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile Avatar"
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                ) : (
                  <User className="size-10 text-slate-400 transition-transform duration-300 group-hover:scale-105" />
                )}
                
                {/* 카메라 호버 오버레이 */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <Camera className="size-5 text-white animate-in fade-in duration-200" />
                  <span className="mt-1 text-[10px] text-white font-medium">사진 변경</span>
                </div>
                
                {/* 업로드 로딩 중 오버레이 */}
                {isUploadingAvatar && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <span className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  </div>
                )}
              </button>
            </div>

            {/* 회원 상세 정보 */}
            <div className="flex-1 w-full text-center sm:text-left px-2">
              <div className="space-y-2">
                <p className="text-[11px] text-slate-400 leading-normal bg-white/5 border border-white/10 rounded-xl px-2.5 py-1.5 inline-block text-left">
                  📢 서로의 얼굴 익히기 위해서 필요하니 꼭 등록해 주세요.
                </p>
                <div className="flex flex-wrap justify-center sm:justify-start items-center gap-2 text-xs">
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-100">레벨 {levelLabel}</span>
                  <span className="rounded-full bg-white/10 px-2.5 py-1 text-slate-100">{roleLabel}</span>
                  {isCoinEnabled && (
                    <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-amber-100">코인 {clubMemberInfo?.coin_balance ?? 0}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          <Link href="/dashboard" className="absolute top-4 right-4">
            <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
              <ArrowLeft className="h-3.5 w-3.5" />
              홈
            </Button>
          </Link>
        </section>



        <section className="rounded-[24px] bg-white px-3 py-3 sm:px-5 sm:py-5 shadow-sm">
          <div>
            <p className="text-xs text-slate-500">보안 설정</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">비밀번호 변경</h2>
          </div>

          <form onSubmit={handlePasswordChange} className="mt-4 space-y-4">
            {passwordError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600">
                {passwordError}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700" htmlFor="newPassword">
                새 비밀번호
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="영문, 숫자, 특수문자 포함 8자 이상"
                className="h-12 w-full rounded-2xl border border-slate-300 px-4 text-sm focus:border-slate-400 focus:outline-none bg-white"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700" htmlFor="confirmPassword">
                새 비밀번호 확인
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="새 비밀번호 다시 입력"
                className="h-12 w-full rounded-2xl border border-slate-300 px-4 text-sm focus:border-slate-400 focus:outline-none bg-white"
                required
              />
            </div>

            <Button
              type="submit"
              disabled={isChangingPassword}
              className="h-12 w-full rounded-2xl bg-[#0f172a] text-base font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {isChangingPassword ? '변경 중...' : '비밀번호 변경'}
            </Button>
          </form>
        </section>

        {/* 회원 레벨 섹션 */}
        <section className="rounded-[24px] bg-white px-4 py-5 shadow-sm sm:px-5 sm:py-6">
          <div className="mb-4">
            {isRatingPeriodActive() ? (
              <>
                <p className="text-xs text-slate-500">회원 레벨</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">회원 상호 급수 평가</h2>
                <p className="mt-1 text-xs text-slate-500">
                  클럽 회원들의 배드민턴 실력에 대해 서로 의견을 공유하는 공간입니다.
                </p>
              </>
            ) : (
              <h2 className="text-lg font-semibold text-slate-900">회원 목록</h2>
            )}
          </div>
          
          {/* 평가 기간 관련 배너 및 저장 배너 */}

          {isSubmitted && isRatingPeriodActive() && (
            <div className="mb-4 rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-800 text-center font-medium text-sm">
              ✓ 이번 평가 기간의 상호 급수 평가가 이미 완료되었습니다. (추가 제출 및 수정 불가)
            </div>
          )}

          {hasDraftChanges() && !isSubmitted && isRatingPeriodActive() && (
            <div className="mb-4 flex flex-col gap-2 rounded-2xl bg-indigo-50 border border-indigo-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-indigo-950 font-medium">수정된 평가 내용이 있습니다. 저장 버튼을 눌러 한 번에 반영하세요.</span>
              <button
                type="button"
                onClick={saveRatings}
                disabled={isSavingRatings}
                className="inline-flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-4 py-2 transition-colors disabled:opacity-50 shrink-0"
              >
                {isSavingRatings ? '저장 중...' : '평가 저장'}
              </button>
            </div>
          )}

          <div className="mb-4 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="회원 이름 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-11 w-full rounded-2xl border border-slate-200 pl-9 pr-4 text-sm focus:border-slate-400 focus:outline-none bg-slate-50/50"
                />
              </div>

              {loadingData ? (
                <div className="text-center py-8 text-sm text-slate-500 bg-slate-50 rounded-xl border border-slate-100">
                  평가 데이터를 불러오는 중입니다...
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="text-center py-8 text-sm text-slate-500 bg-slate-50 rounded-xl border border-slate-100">
                  검색 결과와 일치하는 회원이 없습니다.
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 font-semibold text-xs border-b border-slate-100">
                          <th className="px-4 py-3">회원</th>
                          <th className="px-4 py-3">급수</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {filteredMembers.map((m) => {
                          const isSelf = m.id === user?.id;
                          const currentVote = draftVotes[m.id] || '';

                          return (
                            <tr key={m.id} className="hover:bg-slate-50/30 transition-colors">
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  {/* 회원 프로필 이미지 (사각 모서리 타원 모양 - rounded-xl) */}
                                  <button
                                    type="button"
                                    onClick={() => m.avatar_url && setActivePhotoUrl(m.avatar_url)}
                                    disabled={!m.avatar_url}
                                    className={`relative size-9 shrink-0 overflow-hidden rounded-[12px] bg-slate-100 border border-slate-100 flex items-center justify-center ${m.avatar_url ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
                                  >
                                    {m.avatar_url ? (
                                      <img
                                        src={m.avatar_url}
                                        alt={m.full_name || 'Avatar'}
                                        className="size-full object-cover"
                                      />
                                    ) : (
                                      <User className="size-4 text-slate-400" />
                                    )}
                                  </button>
                                  <div className="font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                                    <span>
                                      {m.full_name || m.username || '회원'}
                                      ({m.gender === 'male' || m.gender === 'M' ? '남' : m.gender === 'female' || m.gender === 'F' ? '여' : '미설정'})
                                    </span>
                                    {isSelf && (
                                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                                        본인
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {!isRatingPeriodActive() ? (
                                  <span className="text-sm font-semibold text-slate-700">
                                    {getFullLevelLabel(m.skill_level)}
                                  </span>
                                ) : isSelf ? (
                                  <span className="text-xs text-slate-400 italic">본인 평가는 불가능합니다</span>
                                ) : (
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <select
                                      value={currentVote}
                                      onChange={(e) => handleDraftVote(m.id, e.target.value)}
                                      disabled={isSelf || isSubmitted || isSavingRatings || !isRatingPeriodActive()}
                                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-slate-300 w-full max-w-[200px] disabled:bg-slate-50 disabled:text-slate-400"
                                    >
                                      <option value="">평가 미선택</option>
                                      {getFilteredLevelsForMember(m.skill_level).map((opt) => (
                                        <option key={opt.code} value={opt.code}>
                                          {opt.description || opt.name || opt.code}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
        </section>
      </div>

      {avatarFile && (
        <AvatarCropModal
          imageFile={avatarFile}
          isOpen={isCropOpen}
          onClose={() => {
            setIsCropOpen(false);
            setAvatarFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
          onCropComplete={handleCropComplete}
        />
      )}

      {/* 회원사진 확대 라이트박스 모달 */}
      {activePhotoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 cursor-pointer animate-in fade-in duration-200"
          onClick={() => setActivePhotoUrl(null)}
        >
          <div
            className="relative max-w-sm w-full rounded-[32px] overflow-hidden bg-white p-2 shadow-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={activePhotoUrl}
              alt="Zoomed Member"
              className="w-full h-auto aspect-square object-cover rounded-[24px]"
            />
            <button
              type="button"
              onClick={() => setActivePhotoUrl(null)}
              className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors focus:outline-none"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

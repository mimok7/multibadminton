'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import type { AdminUser } from '@/types';
import { createMembersBulk, deleteUser, updateUser, updateUsersBulk, updateRatingSettings, resetUserPassword, resetAttendanceAll, resetWinRateAll, resetMemberData } from './actions';
import type { UpdateUserPayload } from './actions';
import { useRouter } from 'next/navigation';
import { Activity, Calendar, Filter, Key, LayoutGrid, List, Save, Search, Shield, Trash2, UserPlus, Users, Trophy, ArrowLeft, RotateCcw } from 'lucide-react';

type LevelOption = {
    code: string;
    description: string | null;
    score: number | null;
};

type AttendanceSummary = Record<
    string,
    {
        total: number;
        last30: number;
        lastAttended: string | null;
    }
>;

type TabKey = 'overview' | 'members' | 'attendance' | 'win-rate' | 'create' | 'rating-period';
type MemberSortKey = 'member' | 'role' | 'level' | 'levelCode' | 'score' | 'gender';
type SortDirection = 'asc' | 'desc';

function formatAdminLevelLabel(option?: LevelOption) {
    if (!option) {
        return '';
    }

    return option.description?.trim() || option.code;
}

function findEtcLevelOption(levelOptions: LevelOption[]) {
    return levelOptions.find((option) => {
        const code = String(option.code || '').trim().toUpperCase();
        return code === 'O' || code === 'ETC';
    });
}

const UNASSIGNED_LEVEL_KEY = '__UNASSIGNED__';

function normalizeEditableRole(value?: string | null): 'user' | 'manager' {
    return String(value || '').trim().toLowerCase() === 'manager' ? 'manager' : 'user';
}

export default function UserManagementClient({
    users,
    myUserId,
    myUserEmail,
    levelOptions: levelOptionsFromDb,
    attendanceSummary,
    initialTab,
    ratingSettings,
}: {
    users: AdminUser[];
    myUserId: string;
    myUserEmail: string;
    levelOptions: LevelOption[];
    attendanceSummary: AttendanceSummary;
    initialTab: string;
    ratingSettings: { start_date: string | null; end_date: string | null };
}) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const formatToLocalDateTimeString = (utcString: string | null) => {
        if (!utcString) return '';
        const date = new Date(utcString);
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = new Date(date.getTime() - offset).toISOString().slice(0, 16);
        return localISOTime;
    };

    const [startDate, setStartDate] = useState(formatToLocalDateTimeString(ratingSettings?.start_date));
    const [endDate, setEndDate] = useState(formatToLocalDateTimeString(ratingSettings?.end_date));
    const [isSavingSettings, setIsSavingSettings] = useState(false);

    const [draftsByUserId, setDraftsByUserId] = useState<Record<string, UpdateUserPayload & { email?: string | null }>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTab, setSelectedTab] = useState<TabKey>('overview');
    const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'manager' | 'user'>('all');
    const [genderFilter, setGenderFilter] = useState<'all' | 'M' | 'F' | 'O' | 'unset'>('all');
    const [levelFilter, setLevelFilter] = useState<string>('all');
    const [sortKey, setSortKey] = useState<MemberSortKey>('member');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [viewMode, setViewMode] = useState<'table' | 'card'>('table');
    const [isMobile, setIsMobile] = useState(false);
    const [memberList, setMemberList] = useState<AdminUser[]>(users);
    const [newMember, setNewMember] = useState({
        full_name: '',
        email: '',
        password: '',
        skill_level: levelOptionsFromDb[0]?.code || '',
        gender: '',
        role: 'user',
    });

    const isSuperAdmin = useMemo(() => {
        const me = users.find(u => u.id === myUserId);
        if (!me) return myUserEmail === 'kjh@hyojacho.es.kr';
        return me.email === 'kjh@hyojacho.es.kr' || me.username === 'kjh' || me.full_name === '김진호';
    }, [users, myUserId, myUserEmail]);

    const isCurrentUserAdmin = useMemo(() => {
        const me = users.find(u => u.id === myUserId);
        if (!me) return myUserEmail === 'kjh@hyojacho.es.kr';
        return me.role === 'admin' || me.email === 'kjh@hyojacho.es.kr' || me.username === 'kjh' || me.full_name === '김진호';
    }, [users, myUserId, myUserEmail]);

    const levelOptions = useMemo(
        () => levelOptionsFromDb.length > 0
            ? levelOptionsFromDb
                .map((item) => item.code)
            : [],
        [levelOptionsFromDb]
    );
    const hasSearchQuery = searchQuery.trim().length > 0;
    const etcLevelOption = useMemo(
        () => findEtcLevelOption(levelOptionsFromDb),
        [levelOptionsFromDb]
    );

    useEffect(() => {
        setMemberList(users);
    }, [users]);

    useEffect(() => {
        const checkMobile = window.matchMedia('(max-width: 768px)').matches;
        setIsMobile(checkMobile);
        if (checkMobile) {
            setViewMode('card');
            setSelectedTab('members');
        }
    }, []);

    useEffect(() => {
        if (initialTab === 'members' || initialTab === 'attendance' || initialTab === 'win-rate' || initialTab === 'create' || initialTab === 'overview') {
            setSelectedTab(initialTab as TabKey);
        }
    }, [initialTab]);

    useEffect(() => {
        const nextDrafts = users.reduce<Record<string, UpdateUserPayload & { email?: string | null }>>((acc, user) => {
            acc[user.id] = {
                full_name: user.full_name ?? '',
                email: user.email ?? '',
                skill_level: normalizeSkillLevel(user.skill_level) || levelOptionsFromDb[0]?.code || '',
                gender: user.gender ?? '',
                role: user.role === 'admin' ? 'admin' : normalizeEditableRole(user.role),
            };
            return acc;
        }, {});

        setDraftsByUserId(nextDrafts);
    }, [users, levelOptionsFromDb]);

    useEffect(() => {
        setNewMember((prev) => (
            prev.skill_level || levelOptionsFromDb.length === 0
                ? prev
                : { ...prev, skill_level: levelOptionsFromDb[0].code }
        ));
    }, [levelOptionsFromDb]);

    const normalizeSkillLevel = (value?: string | null) => String(value || '').trim().toUpperCase();

    const getLevelOptionMeta = (levelCode: string) => {
        const normalizedCode = normalizeSkillLevel(levelCode);
        return levelOptionsFromDb.find((item) => item.code === normalizedCode);
    };

    const sortLevelCodes = (a: string, b: string) => {
        const aScore = getLevelOptionMeta(a)?.score;
        const bScore = getLevelOptionMeta(b)?.score;

        if (typeof aScore === 'number' && typeof bScore === 'number' && aScore !== bScore) {
            return bScore - aScore;
        }

        return a.localeCompare(b);
    };

    const normalizeLevelKey = (value?: string | null) => {
        const normalized = (value || '').trim().toUpperCase();
        return normalized || UNASSIGNED_LEVEL_KEY;
    };

    const formatLevelGroupLabel = (levelCode: string) => {
        if (levelCode === UNASSIGNED_LEVEL_KEY) {
            return formatAdminLevelLabel(etcLevelOption) || '기타';
        }

        const option = getLevelOptionMeta(levelCode);
        return formatAdminLevelLabel(option) || levelCode;
    };

    const handleSaveSettings = () => {
        setIsSavingSettings(true);
        startTransition(async () => {
            const res = await updateRatingSettings(
                startDate ? new Date(startDate).toISOString() : null,
                endDate ? new Date(endDate).toISOString() : null
            );

            setIsSavingSettings(false);
            if (res?.error) {
                alert(`설정 저장 실패: ${res.error}`);
            } else {
                alert('평가 기간이 성공적으로 저장되었습니다.');
                router.refresh();
            }
        });
    };

    const handleDelete = async (user: AdminUser) => {
        if (user.id === myUserId) {
            alert("자기 자신은 삭제할 수 없습니다.");
            return;
        }
        if (await window.confirm(`정말로 '${user.username || user.email}'님을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) {
            startTransition(async () => {
                const result = await deleteUser(user.id);
                if (result?.error) {
                    alert(`사용자 삭제 실패: ${result.error}`);
                } else {
                    setMemberList((prev) => prev.filter((item) => item.id !== user.id));
                    router.refresh();
                    alert('사용자가 성공적으로 삭제되었습니다.');
                }
            });
        }
    };

    const handleResetPassword = async (user: AdminUser) => {
        if (!user.email) {
            alert('이메일 정보가 없는 회원은 비밀번호를 초기화할 수 없습니다.');
            return;
        }

        if (await window.confirm(`'${user.username || user.full_name}' 회원의 비밀번호를 초기 비밀번호('bad123!')로 초기화하시겠습니까?`)) {
            startTransition(async () => {
                const result = await resetUserPassword(user.id, 'bad123!');
                if (result?.error) {
                    alert(`비밀번호 초기화 실패: ${result.error}`);
                } else {
                    alert('비밀번호가 초기 비밀번호(bad123!)로 성공적으로 변경되었습니다.');
                }
            });
        }
    };

    const handleResetMember = async (user: AdminUser) => {
        const displayName = user.full_name || user.username || user.email;
        if (await window.confirm(`'${displayName}' 회원의 모든 데이터(출석 기록 및 코인 전적)를 초기화하시겠습니까?`)) {
            startTransition(async () => {
                const result = await resetMemberData(user.id);
                if (result?.error) {
                    alert(`초기화 실패: ${result.error}`);
                } else {
                    alert('회원의 모든 데이터가 성공적으로 초기화되었습니다.');
                    router.refresh();
                }
            });
        }
    };

    const getDraft = (user: AdminUser) => {
        return draftsByUserId[user.id] ?? {
            full_name: user.full_name ?? '',
            email: user.email ?? '',
            skill_level: normalizeSkillLevel(user.skill_level) || levelOptionsFromDb[0]?.code || '',
            gender: user.gender ?? '',
            role: user.role === 'admin' ? 'admin' : normalizeEditableRole(user.role),
        };
    };

    const updateDraft = (userId: string, patch: Partial<UpdateUserPayload & { email?: string | null }>) => {
        setDraftsByUserId((prev) => ({
            ...prev,
            [userId]: {
                ...(prev[userId] || {}),
                ...patch,
            },
        }));
    };

    const hasPendingChanges = (user: AdminUser) => {
        const draft = getDraft(user);
        const currentRole = user.role === 'admin' ? 'admin' : normalizeEditableRole(user.role);

        return (
            (draft.full_name ?? '') !== (user.full_name ?? '')
            || normalizeSkillLevel(draft.skill_level) !== normalizeSkillLevel(user.skill_level)
            || (draft.gender ?? '') !== (user.gender ?? '')
            || ((draft.role === 'admin' ? 'admin' : normalizeEditableRole(draft.role)) !== currentRole)
        );
    };

    const saveEdit = (user: AdminUser) => {
        const draft = getDraft(user);

        startTransition(async () => {
            const payload: UpdateUserPayload = {
                full_name: draft.full_name,
                skill_level: normalizeSkillLevel(draft.skill_level),
                gender: draft.gender,
                role: draft.role === 'admin' ? 'admin' : normalizeEditableRole(draft.role),
            };
            const res = await updateUser(user.id, payload);
            if (res?.error) {
                alert(`수정 실패: ${res.error}`);
            } else {
                setMemberList((prev) => prev.map((item) => item.id === user.id ? ({
                    ...item,
                    full_name: draft.full_name ?? undefined,
                    skill_level: normalizeSkillLevel(draft.skill_level),
                    skill_label: getLevelOptionMeta(normalizeSkillLevel(draft.skill_level))?.description ?? item.skill_label,
                    gender: draft.gender ?? undefined,
                    role: draft.role === 'admin' ? 'admin' : normalizeEditableRole(draft.role),
                }) : item));
                router.refresh();
            }
        });
    };

    const handleCreateMember = () => {
        if (!newMember.full_name.trim()) {
            alert('회원 이름을 입력해 주세요.');
            return;
        }

        startTransition(async () => {
            const result = await createMembersBulk({
                full_names: newMember.full_name,
                skill_level: normalizeSkillLevel(newMember.skill_level),
                role: newMember.role as 'manager' | 'member',
            });

            if (result?.error) {
                alert(`회원 추가 실패: ${result.error}`);
                return;
            }

            const failCount = result.failCount ?? 0;
            const successCount = result.successCount ?? 0;

            if (failCount > 0) {
                alert(`일부 회원 추가 실패 (${failCount}명). 성공: ${successCount}명.`);
            } else {
                alert(`성공적으로 추가되었습니다 (${successCount}명).`);
            }

            setNewMember({
                full_name: '',
                email: '',
                password: '',
                skill_level: levelOptionsFromDb[0]?.code || '',
                gender: '',
                role: 'user',
            });
            router.refresh();
        });
    };

    const filteredUsers = useMemo(() => {
        const keyword = searchQuery.trim().toLowerCase();

        return memberList.filter((user) => {
            const normalizedRole = user.role === 'admin' ? 'admin' : normalizeEditableRole(user.role);
            const normalizedLevel = normalizeSkillLevel(user.skill_level);
            const normalizedGender = (user.gender || '').toUpperCase();

            if (roleFilter !== 'all' && normalizedRole !== roleFilter) {
                return false;
            }

            if (levelFilter !== 'all' && normalizedLevel !== levelFilter) {
                return false;
            }

            if (genderFilter === 'unset' && normalizedGender) {
                return false;
            }

            if (genderFilter !== 'all' && genderFilter !== 'unset' && normalizedGender !== genderFilter) {
                return false;
            }

            if (!keyword) {
                return true;
            }

            const values = [
                user.full_name,
                user.email,
                user.username,
                user.skill_label,
                normalizeSkillLevel(user.skill_level),
                getLevelOptionMeta(normalizeSkillLevel(user.skill_level))?.description,
                user.gender,
                user.role,
            ];

            return values.some((value) => (value || '').toString().toLowerCase().includes(keyword));
        });
    }, [genderFilter, levelFilter, memberList, roleFilter, searchQuery, levelOptionsFromDb]);

    const getRoleSortWeight = (role?: string | null) => {
        const normalizedRole = String(role || '').trim().toLowerCase();
        if (normalizedRole === 'admin') return 0;
        if (normalizedRole === 'manager') return 1;
        return 2;
    };

    const getGenderSortWeight = (gender?: string | null) => {
        const normalizedGender = String(gender || '').trim().toUpperCase();
        if (normalizedGender === 'M') return 0;
        if (normalizedGender === 'F') return 1;
        if (normalizedGender === 'O') return 2;
        return 3;
    };

    const sortedUsers = useMemo(() => {
        const directionFactor = sortDirection === 'asc' ? 1 : -1;

        return [...filteredUsers].sort((left, right) => {
            let comparison = 0;

            if (sortKey === 'member') {
                comparison = (left.full_name || left.username || left.email || '').localeCompare(
                    right.full_name || right.username || right.email || '',
                    'ko',
                    { sensitivity: 'base' }
                );
            } else if (sortKey === 'role') {
                comparison = getRoleSortWeight(left.role) - getRoleSortWeight(right.role);
            } else if (sortKey === 'level') {
                comparison = sortLevelCodes(normalizeSkillLevel(left.skill_level), normalizeSkillLevel(right.skill_level));
            } else if (sortKey === 'levelCode') {
                comparison = normalizeSkillLevel(left.skill_level).localeCompare(
                    normalizeSkillLevel(right.skill_level),
                    'ko',
                    { sensitivity: 'base' }
                );
            } else if (sortKey === 'score') {
                comparison = (getLevelOptionMeta(normalizeSkillLevel(right.skill_level))?.score ?? -Infinity)
                    - (getLevelOptionMeta(normalizeSkillLevel(left.skill_level))?.score ?? -Infinity);
            } else if (sortKey === 'gender') {
                comparison = getGenderSortWeight(left.gender) - getGenderSortWeight(right.gender);
            }

            if (comparison !== 0) {
                return comparison * directionFactor;
            }

            return (left.full_name || left.username || left.email || '').localeCompare(
                right.full_name || right.username || right.email || '',
                'ko',
                { sensitivity: 'base' }
            );
        });
    }, [filteredUsers, sortDirection, sortKey, levelOptionsFromDb]);

    const toggleSort = (nextKey: MemberSortKey) => {
        if (sortKey === nextKey) {
            setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
            return;
        }

        setSortKey(nextKey);
        setSortDirection('asc');
    };

    const getSortIndicator = (targetKey: MemberSortKey) => {
        if (sortKey !== targetKey) {
            return '↕';
        }

        return sortDirection === 'asc' ? '↑' : '↓';
    };

    const dirtyUserIds = useMemo(
        () => memberList.filter((user) => hasPendingChanges(user)).map((user) => user.id),
        [memberList, draftsByUserId]
    );

    const dirtyCount = dirtyUserIds.length;

    const levelSummary = useMemo(() => {
        const counts = new Map<string, { total: number; male: number; female: number }>();

        for (const user of memberList) {
            const levelKey = normalizeLevelKey(normalizeSkillLevel(user.skill_level));
            const current = counts.get(levelKey) || { total: 0, male: 0, female: 0 };
            current.total += 1;
            if (user.gender === 'M') current.male += 1;
            if (user.gender === 'F') current.female += 1;
            counts.set(levelKey, current);
        }

        const orderedLevelKeys = [
            ...levelOptions.filter((level) => counts.has(level)),
            ...Array.from(counts.keys())
                .filter((level) => !levelOptions.includes(level))
                .sort(sortLevelCodes),
        ];

        return orderedLevelKeys.map((level) => ({
            level,
            count: counts.get(level) || { total: 0, male: 0, female: 0 },
        }));
    }, [memberList, levelOptions]);

    const saveAllEdits = () => {
        if (dirtyCount === 0) {
            alert('저장할 수정 내용이 없습니다.');
            return;
        }

        const items = memberList
            .filter((user) => dirtyUserIds.includes(user.id))
            .map((user) => {
                const draft = getDraft(user);
                return {
                    userId: user.id,
                    updates: {
                        full_name: draft.full_name,
                        username: draft.full_name,
                        skill_level: normalizeSkillLevel(draft.skill_level),
                        gender: draft.gender,
                        role: draft.role === 'admin' ? 'admin' : normalizeEditableRole(draft.role),
                    } satisfies UpdateUserPayload,
                };
            });

        startTransition(async () => {
            const res = await updateUsersBulk(items);
            if (res?.error) {
                alert(`전체 저장 실패: ${res.error}`);
                return;
            }

            setMemberList((prev) => prev.map((item) => {
                const dirtyUser = memberList.find((user) => user.id === item.id);
                if (!dirtyUser || !dirtyUserIds.includes(item.id)) {
                    return item;
                }

                const draft = getDraft(dirtyUser);
                return {
                    ...item,
                    full_name: draft.full_name ?? undefined,
                    username: draft.full_name ?? undefined,
                    skill_level: normalizeSkillLevel(draft.skill_level),
                    skill_label: getLevelOptionMeta(normalizeSkillLevel(draft.skill_level))?.description ?? item.skill_label,
                    gender: draft.gender ?? undefined,
                    role: draft.role === 'admin' ? 'admin' : normalizeEditableRole(draft.role),
                };
            }));
            router.refresh();
        });
    };

    const attendanceRows = useMemo(() => {
        return filteredUsers
            .map((user) => ({
                ...user,
                attendance: attendanceSummary[user.id] || {
                    total: 0,
                    last30: 0,
                    lastAttended: null,
                },
            }))
            .sort((left, right) => {
                if (right.attendance.total !== left.attendance.total) {
                    return right.attendance.total - left.attendance.total;
                }

                return (left.full_name || left.username || left.email).localeCompare(right.full_name || right.username || right.email);
            });
    }, [attendanceSummary, filteredUsers]);

    const winRateRows = useMemo(() => {
        return [...filteredUsers]
            .map((user) => ({
                ...user,
                coin_wins: user.coin_wins || 0,
                coin_losses: user.coin_losses || 0,
                total_games: (user.coin_wins || 0) + (user.coin_losses || 0),
                win_rate: ((user.coin_wins || 0) + (user.coin_losses || 0)) > 0
                    ? (user.coin_wins || 0) / ((user.coin_wins || 0) + (user.coin_losses || 0))
                    : 0,
            }))
            .sort((left, right) => {
                if (right.win_rate !== left.win_rate) {
                    return right.win_rate - left.win_rate;
                }
                if (right.total_games !== left.total_games) {
                    return right.total_games - left.total_games;
                }
                return (left.full_name || left.username || left.email || '').localeCompare(right.full_name || right.username || right.email || '');
            });
    }, [filteredUsers]);

    const overview = useMemo(() => {
        const adminCount = memberList.filter((user) => user.role === 'admin').length;
        const managerCount = memberList.filter((user) => user.role === 'manager').length;
        const linkedCount = memberList.filter((user) => Boolean(user.email)).length;
        const topAttendance = [...memberList]
            .map((user) => ({
                ...user,
                attendance: attendanceSummary[user.id] || { total: 0, last30: 0, lastAttended: null },
            }))
            .sort((left, right) => right.attendance.total - left.attendance.total)
            .slice(0, 5);

        const topWinRate = [...memberList]
            .map((user) => ({
                ...user,
                coin_wins: user.coin_wins || 0,
                coin_losses: user.coin_losses || 0,
                total_games: (user.coin_wins || 0) + (user.coin_losses || 0),
                win_rate: ((user.coin_wins || 0) + (user.coin_losses || 0)) > 0
                    ? (user.coin_wins || 0) / ((user.coin_wins || 0) + (user.coin_losses || 0))
                    : 0,
            }))
            .filter((user) => user.total_games > 0)
            .sort((left, right) => {
                if (right.win_rate !== left.win_rate) {
                    return right.win_rate - left.win_rate;
                }
                if (right.total_games !== left.total_games) {
                    return right.total_games - left.total_games;
                }
                return (left.full_name || left.username || left.email || '').localeCompare(right.full_name || right.username || right.email || '');
            })
            .slice(0, 5);

        return {
            adminCount,
            managerCount,
            linkedCount,
            topAttendance,
            topWinRate,
        };
    }, [attendanceSummary, memberList]);

    const tabButtonClass = (tab: TabKey, displayClass = 'inline-flex') =>
        `${displayClass} items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            selectedTab === tab
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`;

    const renderMemberTable = () => (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                        <tr>
                            <th className="px-4 py-3 text-left font-semibold">
                                <button type="button" onClick={() => toggleSort('member')} className="inline-flex items-center gap-1 hover:text-slate-900">
                                    회원
                                    <span className="text-xs">{getSortIndicator('member')}</span>
                                </button>
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                <button type="button" onClick={() => toggleSort('role')} className="inline-flex items-center gap-1 hover:text-slate-900">
                                    역할
                                    <span className="text-xs">{getSortIndicator('role')}</span>
                                </button>
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                <button type="button" onClick={() => toggleSort('level')} className="inline-flex items-center gap-1 hover:text-slate-900">
                                    급수
                                    <span className="text-xs">{getSortIndicator('level')}</span>
                                </button>
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                <button type="button" onClick={() => toggleSort('levelCode')} className="inline-flex items-center gap-1 hover:text-slate-900">
                                    레벨
                                    <span className="text-xs">{getSortIndicator('levelCode')}</span>
                                </button>
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                <button type="button" onClick={() => toggleSort('score')} className="inline-flex items-center gap-1 hover:text-slate-900">
                                    점수
                                    <span className="text-xs">{getSortIndicator('score')}</span>
                                </button>
                            </th>
                            <th className="px-4 py-3 text-left font-semibold">
                                <button type="button" onClick={() => toggleSort('gender')} className="inline-flex items-center gap-1 hover:text-slate-900">
                                    성별
                                    <span className="text-xs">{getSortIndicator('gender')}</span>
                                </button>
                            </th>
                            <th className="px-4 py-3 text-right font-semibold">작업</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                        {sortedUsers.map((user) => {
                            const draft = getDraft(user);
                            const isDirty = hasPendingChanges(user);
                            const normalizedRole = user.role === 'admin' ? 'admin' : normalizeEditableRole(user.role);
                            const currentLevelCode = normalizeSkillLevel(draft.skill_level) || levelOptionsFromDb[0]?.code || '';
                            const currentLevelOption = getLevelOptionMeta(currentLevelCode);

                            return (
                                <tr key={user.id} className={isDirty ? 'bg-amber-50/60' : 'bg-white'}>
                                    <td className="px-4 py-3 align-top">
                                        <div className="space-y-2">
                                            <input
                                                value={draft.full_name ?? ''}
                                                onChange={(e) => updateDraft(user.id, { full_name: e.target.value })}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                                placeholder="회원 이름"
                                            />
                                            <div className="text-xs text-slate-500">
                                                {user.username || '-'}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        {normalizedRole === 'admin' ? (
                                            <span className="inline-flex items-center rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">
                                                admin
                                            </span>
                                        ) : (
                                            <select
                                                value={normalizeEditableRole(draft.role)}
                                                onChange={(e) => updateDraft(user.id, { role: e.target.value as 'user' | 'manager' })}
                                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                            >
                                                <option value="user">user</option>
                                                <option value="manager">manager</option>
                                            </select>
                                        )}
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <select
                                            value={currentLevelCode}
                                            onChange={(e) => updateDraft(user.id, { skill_level: e.target.value })}
                                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                                        >
                                            {levelOptions.map((levelCode) => {
                                                const option = getLevelOptionMeta(levelCode);
                                                return (
                                                    <option key={levelCode} value={levelCode}>
                                                        {formatAdminLevelLabel(option) || levelCode}
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                                            {currentLevelCode || '-'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
                                            {typeof currentLevelOption?.score === 'number' ? currentLevelOption.score : '-'}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <select
                                            value={draft.gender ?? ''}
                                            onChange={(e) => updateDraft(user.id, { gender: e.target.value })}
                                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                                        >
                                            <option value="">미지정</option>
                                            <option value="M">남성</option>
                                            <option value="F">여성</option>
                                            <option value="O">기타</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-3 align-top">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => saveEdit(user)}
                                                disabled={isPending || !isDirty}
                                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-700 disabled:opacity-40"
                                            >
                                                <Save className="size-3.5" />
                                                저장
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleResetPassword(user)}
                                                disabled={isPending}
                                                className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                                            >
                                                <Key className="size-3.5" />
                                                비밀번호
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleResetMember(user)}
                                                disabled={isPending}
                                                className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                            >
                                                <RotateCcw className="size-3.5" />
                                                초기화
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(user)}
                                                disabled={isPending || user.id === myUserId}
                                                className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 disabled:opacity-40"
                                            >
                                                <Trash2 className="size-3.5" />
                                                삭제
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );

    const renderMemberCards = () => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5">
            {sortedUsers.map((user) => {
                const draft = getDraft(user);
                const isDirty = hasPendingChanges(user);
                const normalizedRole = user.role === 'admin' ? 'admin' : normalizeEditableRole(user.role);
                const currentLevelCode = normalizeSkillLevel(draft.skill_level) || levelOptionsFromDb[0]?.code || '';
                const currentLevelOption = getLevelOptionMeta(currentLevelCode);

                return (
                    <div
                        key={user.id}
                        className={`rounded-xl border p-4 sm:p-5 transition-all shadow-sm flex flex-col justify-between ${
                            isDirty 
                                ? 'bg-amber-50/60 border-amber-300 shadow-md ring-1 ring-amber-300' 
                                : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md'
                        }`}
                    >
                        <div>
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <input
                                        value={draft.full_name ?? ''}
                                        onChange={(e) => updateDraft(user.id, { full_name: e.target.value })}
                                        className="w-full font-bold text-lg text-slate-800 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-slate-400 focus:outline-none px-1 py-0.5 rounded"
                                        placeholder="회원 이름"
                                    />
                                    <div className="hidden md:block text-xs text-slate-400 mt-1 px-1">
                                        아이디: {user.username || '-'}
                                    </div>
                                </div>
                                <div className="shrink-0 flex flex-col items-end gap-1">
                                    {normalizedRole === 'admin' ? (
                                        <span className="hidden md:inline-flex items-center rounded-md bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
                                            admin
                                        </span>
                                    ) : (
                                        <span className={`hidden md:inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                                            normalizedRole === 'manager' 
                                                ? 'bg-indigo-100 text-indigo-700' 
                                                : 'bg-slate-100 text-slate-700'
                                        }`}>
                                            {normalizedRole}
                                        </span>
                                    )}
                                    {user.email && (
                                        <span className="hidden md:inline text-[10px] text-slate-400 font-medium">연결됨</span>
                                    )}
                                </div>
                            </div>

                            {/* Card Content Grid */}
                            <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-slate-100 text-sm">
                                {/* Role Selection */}
                                <div className="flex flex-col">
                                    <span className="text-xs text-slate-400 font-medium">역할</span>
                                    {normalizedRole === 'admin' ? (
                                        <span className="mt-1.5 font-semibold text-slate-700">관리자 (Admin)</span>
                                    ) : (
                                        <select
                                            value={normalizeEditableRole(draft.role)}
                                            onChange={(e) => updateDraft(user.id, { role: e.target.value as 'user' | 'manager' })}
                                            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500"
                                        >
                                            <option value="user">일반회원 (user)</option>
                                            <option value="manager">매니저 (manager)</option>
                                        </select>
                                    )}
                                </div>

                                {/* Gender Selection */}
                                <div className="flex flex-col">
                                    <span className="text-xs text-slate-400 font-medium">성별</span>
                                    <select
                                        value={draft.gender ?? ''}
                                        onChange={(e) => updateDraft(user.id, { gender: e.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm bg-white"
                                    >
                                        <option value="">미지정</option>
                                        <option value="M">남성</option>
                                        <option value="F">여성</option>
                                        <option value="O">기타</option>
                                    </select>
                                </div>

                                {/* Skill Level Selection */}
                                <div className="flex flex-col col-span-2">
                                    <span className="text-xs text-slate-400 font-medium">급수</span>
                                    <select
                                        value={currentLevelCode}
                                        onChange={(e) => updateDraft(user.id, { skill_level: e.target.value })}
                                        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm bg-white disabled:bg-slate-50 disabled:text-slate-500"
                                    >
                                        {levelOptions.map((levelCode) => {
                                            const option = getLevelOptionMeta(levelCode);
                                            return (
                                                <option key={levelCode} value={levelCode}>
                                                    {formatAdminLevelLabel(option) || levelCode}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>

                                {/* Level Code & Score Display */}
                                <div className="hidden md:flex flex-col">
                                    <span className="text-xs text-slate-400 font-medium">레벨 코드</span>
                                    <div className="mt-1 font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-center font-mono">
                                        {currentLevelCode || '-'}
                                    </div>
                                </div>
                                <div className="hidden md:flex flex-col">
                                    <span className="text-xs text-slate-400 font-medium">급수 점수</span>
                                    <div className="mt-1 font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-center">
                                        {typeof currentLevelOption?.score === 'number' ? `${currentLevelOption.score}점` : '-'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Card Actions Footer */}
                        <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => saveEdit(user)}
                                disabled={isPending || !isDirty}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                            >
                                <Save className="size-3.5" />
                                저장
                            </button>
                            <button
                                type="button"
                                onClick={() => handleResetPassword(user)}
                                disabled={isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-40"
                            >
                                <Key className="size-3.5" />
                                비밀번호
                            </button>
                            <button
                                type="button"
                                onClick={() => handleResetMember(user)}
                                disabled={isPending}
                                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-40"
                            >
                                <RotateCcw className="size-3.5" />
                                초기화
                            </button>
                            <button
                                type="button"
                                onClick={() => handleDelete(user)}
                                disabled={isPending || user.id === myUserId}
                                className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-40"
                            >
                                <Trash2 className="size-3.5" />
                                삭제
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );

    return (
        <div className="space-y-4 sm:space-y-6">
            <section className="relative overflow-hidden rounded-[24px] bg-[#0f172a] px-4 py-4 text-white shadow-[0_18px_50px_-30px_rgba(15,23,42,0.85)] mb-4 sm:mb-6">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_120%,rgba(99,102,241,0.15),transparent_50%)] pointer-events-none" />
                <div className="relative z-10 flex items-center justify-between px-1">
                    <div className="space-y-0.5 pl-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-3 py-0.5 text-[11px] font-semibold text-indigo-300">
                            <Users className="h-3.5 w-3.5" />
                            회원관리
                        </span>
                        <h1 className="text-xl font-bold tracking-tight">회원 운영 센터</h1>
                        <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">회원 정보, 권한, 급수, 출석 흐름을 한 화면에서 관리합니다.</p>
                    </div>
                    <Link href="/admin">
                        <Button variant="outline" className="rounded-full bg-white/10 px-3.5 py-2 text-xs font-bold text-white transition hover:bg-white/15 border-0 flex items-center gap-1.5">
                            <ArrowLeft className="h-3.5 w-3.5" />
                            홈
                        </Button>
                    </Link>
                </div>
                <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-white/10 text-[11px] text-slate-200">
                    <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1">
                        전체 회원: <span className="font-semibold text-white">{memberList.length}명</span>
                    </span>
                    <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1">
                        매니저: <span className="font-semibold text-white">{overview.managerCount}명</span>
                    </span>
                    <span className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1">
                        연결 완료: <span className="font-semibold text-white">{overview.linkedCount}명</span>
                    </span>
                </div>
            </section>

            <section className="rounded-[24px] border border-slate-200 bg-white overflow-hidden shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3 bg-slate-50/50">
                    <div className="flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => setSelectedTab('overview')} className={tabButtonClass('overview', 'hidden md:inline-flex')}>
                            <Users className="size-4" />
                            개요
                        </button>
                        <button type="button" onClick={() => setSelectedTab('members')} className={tabButtonClass('members')}>
                            <Shield className="size-4" />
                            회원 관리
                        </button>
                        <button type="button" onClick={() => setSelectedTab('attendance')} className={tabButtonClass('attendance')}>
                            <Activity className="size-4" />
                            출석 현황
                        </button>
                        <button type="button" onClick={() => setSelectedTab('win-rate')} className={tabButtonClass('win-rate')}>
                            <Trophy className="size-4" />
                            승률 현황
                        </button>
                        <button type="button" onClick={() => setSelectedTab('create')} className={tabButtonClass('create')}>
                            <UserPlus className="size-4" />
                            회원 추가
                        </button>
                        <button type="button" onClick={() => setSelectedTab('rating-period')} className={tabButtonClass('rating-period', 'hidden md:inline-flex')}>
                            <Calendar className="size-4" />
                            평가 기간 설정
                        </button>
                    </div>
                </div>
                <div className="hidden md:block px-4 py-4 sm:px-6 sm:py-5">
                    <div className="grid gap-2 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                        <label className="relative block">
                            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                            <input
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="이름, 이메일, 급수, 역할 검색"
                                className="h-11 w-full rounded-md border border-slate-300 bg-white pl-10 pr-3 text-sm"
                            />
                        </label>
                        <select
                            value={roleFilter}
                            onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
                            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm"
                        >
                            <option value="all">전체 역할</option>
                            <option value="admin">admin</option>
                            <option value="manager">manager</option>
                            <option value="user">user</option>
                        </select>
                        <select
                            value={levelFilter}
                            onChange={(e) => setLevelFilter(e.target.value)}
                            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm"
                        >
                            <option value="all">전체 급수</option>
                            {levelOptions.map((levelCode) => (
                                <option key={levelCode} value={levelCode}>
                                    {formatAdminLevelLabel(getLevelOptionMeta(levelCode)) || levelCode}
                                </option>
                            ))}
                        </select>
                        <select
                            value={genderFilter}
                            onChange={(e) => setGenderFilter(e.target.value as typeof genderFilter)}
                            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm"
                        >
                            <option value="all">전체 성별</option>
                            <option value="M">남성</option>
                            <option value="F">여성</option>
                            <option value="O">기타</option>
                            <option value="unset">미지정</option>
                        </select>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 sm:mt-3 sm:gap-3 sm:text-sm">
                        <div className="inline-flex items-center gap-2">
                            <Filter className="size-4" />
                            현재 표시 {filteredUsers.length}명
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                setRoleFilter('all');
                                setGenderFilter('all');
                                setLevelFilter('all');
                            }}
                            className="rounded-md border border-slate-200 px-3 py-2 text-slate-600 hover:bg-slate-50"
                        >
                            필터 초기화
                        </button>
                    </div>
                </div>
            </section>

            {selectedTab === 'overview' && (
                <div className="grid gap-4 lg:grid-cols-4 lg:gap-6">
                    {/* 1. 급수 분포 */}
                    <section className="hidden md:block rounded-lg border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-2">
                        <h2 className="text-lg font-semibold text-slate-900">급수 분포</h2>
                        <div className="mt-3 grid gap-2 sm:mt-4 sm:gap-3 grid-cols-2 xl:grid-cols-3">
                            {levelSummary.map((item) => (
                                <div key={item.level} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                                    <div className="text-sm font-semibold text-slate-900">{formatLevelGroupLabel(item.level)}</div>
                                    <div className="mt-2 text-2xl font-semibold text-slate-900">{item.count.total}</div>
                                    <div className="mt-1 text-xs text-slate-500">
                                        남 {item.count.male} / 여 {item.count.female}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* 2. 승률 상위 */}
                    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-1">
                        <h2 className="text-lg font-semibold text-slate-900">승률 상위 5</h2>
                        <div className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
                            {overview.topWinRate.length === 0 ? (
                                <div className="text-center py-6 text-sm text-slate-500">
                                    기록된 경기 결과가 없습니다.
                                </div>
                            ) : (
                                overview.topWinRate.map((user, index) => {
                                    const winRate = user.total_games > 0 ? ((user.coin_wins / user.total_games) * 100).toFixed(1) : '0.0';
                                    return (
                                        <div key={user.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                                            <div>
                                                <div className="text-sm font-semibold text-slate-900">
                                                    {index + 1}. {user.full_name || user.username || user.email}
                                                </div>
                                                <div className="text-xs text-slate-500">
                                                    {user.coin_wins}승 {user.coin_losses}패 (총 {user.total_games}경기)
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-lg font-bold text-slate-900">{winRate}%</div>
                                                <div className="text-xs text-slate-500">승률</div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>

                    {/* 3. 출석 상위 */}
                    <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-1">
                        <h2 className="text-lg font-semibold text-slate-900">출석 상위</h2>
                        <div className="mt-3 space-y-2.5 sm:mt-4 sm:space-y-3">
                            {overview.topAttendance.map((user, index) => (
                                <div key={user.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                                    <div>
                                        <div className="text-sm font-semibold text-slate-900">
                                            {index + 1}. {user.full_name || user.username || user.email}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            최근 30일 {user.attendance.last30}회
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-lg font-semibold text-slate-900">{user.attendance.total}</div>
                                        <div className="text-xs text-slate-500">누적</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            )}

            {selectedTab === 'members' && (
                <div className="space-y-3 sm:space-y-4">
                    <section className="flex flex-col gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 sm:gap-3 sm:p-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-sm font-semibold text-sky-900">변경 대기</div>
                            <div className="text-sm text-sky-700">
                                {dirtyCount > 0 ? `${dirtyCount}명의 수정 내용이 아직 저장되지 않았습니다.` : '현재 저장 대기 중인 수정 내용이 없습니다.'}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={saveAllEdits}
                            disabled={isPending || dirtyCount === 0}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                        >
                            <Save className="size-4" />
                            전체 저장
                        </button>
                    </section>
                    <div className="hidden md:flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setViewMode('table')}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                viewMode === 'table'
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            <List className="size-3.5" />
                            표 보기
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('card')}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                viewMode === 'card'
                                    ? 'bg-slate-900 text-white border-slate-900'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                        >
                            <LayoutGrid className="size-3.5" />
                            카드 보기
                        </button>
                    </div>

                    {viewMode === 'table' ? renderMemberTable() : renderMemberCards()}
                </div>
            )}

            {selectedTab === 'attendance' && (
                <div className="space-y-3 sm:space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-semibold text-slate-900 px-1">회원별 출석 현황</h2>
                        <div className="flex justify-end gap-2">
                            {isSuperAdmin && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (await confirm('모든 회원의 출석 기록을 완전히 삭제하고 초기화하시겠습니까?\n이 작업은 취소할 수 없습니다.')) {
                                            startTransition(async () => {
                                                const res = await resetAttendanceAll();
                                                if (res?.error) alert(`출석 초기화 실패: ${res.error}`);
                                                else {
                                                    alert('모든 회원의 출석 기록이 초기화되었습니다.');
                                                    router.refresh();
                                                }
                                            });
                                        }
                                    }}
                                    className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                                    disabled={isPending}
                                >
                                    <Trash2 className="size-3.5" />
                                    전원 일괄 초기화
                                </button>
                            )}
                            <div className="hidden md:flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('table')}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                        viewMode === 'table'
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    <List className="size-3.5" />
                                    표 보기
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('card')}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                        viewMode === 'card'
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    <LayoutGrid className="size-3.5" />
                                    카드 보기
                                </button>
                            </div>
                        </div>
                    </div>

                    {(viewMode === 'table' || isMobile) ? (
                        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-100 text-slate-600">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-semibold">회원</th>
                                            <th className="px-4 py-3 text-right font-semibold">누적 출석</th>
                                            <th className="px-4 py-3 text-right font-semibold">최근 30일</th>
                                            <th className="px-4 py-3 text-left font-semibold">마지막 출석</th>
                                            <th className="px-4 py-3 text-right font-semibold">작업</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {attendanceRows.map((user) => (
                                            <tr key={user.id}>
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-slate-900">{user.full_name || user.username || user.email}</div>
                                                    <div className="text-xs text-slate-500">{formatLevelGroupLabel(normalizeLevelKey(user.skill_level))}</div>
                                                </td>
                                                <td className="px-4 py-3 text-right font-semibold text-slate-900">{user.attendance.total}</td>
                                                <td className="px-4 py-3 text-right font-semibold text-slate-700">{user.attendance.last30}</td>
                                                <td className="px-4 py-3 text-slate-500">{user.attendance.lastAttended || '-'}</td>
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleResetMember(user)}
                                                        disabled={isPending}
                                                        className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                                    >
                                                        <RotateCcw className="size-3" />
                                                        초기화
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                            {attendanceRows.map((user) => (
                                <div key={user.id} className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between">
                                    <div>
                                        <div className="font-bold text-base text-slate-800 truncate" title={user.full_name || user.username || user.email}>
                                            {user.full_name || user.username || user.email}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-0.5">{formatLevelGroupLabel(normalizeLevelKey(user.skill_level))}</div>
                                    </div>
                                    <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-1 text-xs">
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">누적 출석</span>
                                            <span className="font-semibold text-slate-900">{user.attendance.total}회</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">최근 30일</span>
                                            <span className="font-semibold text-slate-700">{user.attendance.last30}회</span>
                                        </div>
                                        <div className="flex justify-between pt-1">
                                            <span className="text-slate-400">마지막</span>
                                            <span className="text-slate-500 truncate max-w-[80px]" title={user.attendance.lastAttended || '-'}>
                                                {user.attendance.lastAttended || '-'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="mt-2.5 pt-2 border-t border-slate-100 flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => handleResetMember(user)}
                                            disabled={isPending}
                                            className="w-full inline-flex items-center justify-center gap-1 rounded border border-blue-200 bg-blue-50/30 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                        >
                                            <RotateCcw className="size-3" />
                                            데이터 초기화
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {selectedTab === 'win-rate' && (
                <div className="space-y-3 sm:space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-lg font-semibold text-slate-900 px-1">회원별 승률 현황</h2>
                        <div className="flex justify-end gap-2">
                            {isSuperAdmin && (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (await confirm('모든 회원의 승률(승/패 전적) 기록을 0으로 초기화하시겠습니까?\n이 작업은 취소할 수 없습니다.')) {
                                            startTransition(async () => {
                                                const res = await resetWinRateAll();
                                                if (res?.error) alert(`승률 초기화 실패: ${res.error}`);
                                                else {
                                                    alert('모든 회원의 승률 기록이 초기화되었습니다.');
                                                    router.refresh();
                                                }
                                            });
                                        }
                                    }}
                                    className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors"
                                    disabled={isPending}
                                >
                                    <Trash2 className="size-3.5" />
                                    전원 일괄 초기화
                                </button>
                            )}
                            <div className="hidden md:flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setViewMode('table')}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                        viewMode === 'table'
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    <List className="size-3.5" />
                                    표 보기
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('card')}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                        viewMode === 'card'
                                            ? 'bg-slate-900 text-white border-slate-900'
                                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                    }`}
                                >
                                    <LayoutGrid className="size-3.5" />
                                    카드 보기
                                </button>
                            </div>
                        </div>
                    </div>

                    {(viewMode === 'table' || isMobile) ? (
                        <section className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead className="bg-slate-100 text-slate-600">
                                        <tr>
                                            <th className="px-4 py-3 text-center font-semibold w-16">순위</th>
                                            <th className="px-4 py-3 text-left font-semibold">회원</th>
                                            <th className="px-4 py-3 text-right font-semibold">승률</th>
                                            <th className="px-4 py-3 text-right font-semibold">승</th>
                                            <th className="px-4 py-3 text-right font-semibold">패</th>
                                            <th className="px-4 py-3 text-right font-semibold">총 경기수</th>
                                            <th className="px-4 py-3 text-right font-semibold">작업</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {winRateRows.length === 0 ? (
                                            <tr>
                                                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                                                    해당 조건의 회원이 없습니다.
                                                </td>
                                            </tr>
                                        ) : (
                                            winRateRows.map((user, index) => {
                                                const total = (user.coin_wins || 0) + (user.coin_losses || 0);
                                                const winRate = total > 0 ? ((user.coin_wins || 0) / total * 100).toFixed(1) : '0.0';
                                                return (
                                                    <tr key={user.id} className="hover:bg-slate-50">
                                                        <td className="px-4 py-3 text-center font-medium text-slate-500">{index + 1}</td>
                                                        <td className="px-4 py-3">
                                                            <div className="font-medium text-slate-900">{user.full_name || user.username || user.email}</div>
                                                            <div className="text-xs text-slate-500">{formatLevelGroupLabel(normalizeLevelKey(user.skill_level))}</div>
                                                        </td>
                                                        <td className="px-4 py-3 text-right font-bold text-slate-900">{winRate}%</td>
                                                        <td className="px-4 py-3 text-right font-semibold text-emerald-600">{user.coin_wins || 0}</td>
                                                        <td className="px-4 py-3 text-right font-semibold text-rose-600">{user.coin_losses || 0}</td>
                                                        <td className="px-4 py-3 text-right font-medium text-slate-700">{total}</td>
                                                        <td className="px-4 py-3 text-right">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleResetMember(user)}
                                                                disabled={isPending}
                                                                className="inline-flex items-center gap-1 rounded-md border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                                            >
                                                                <RotateCcw className="size-3" />
                                                                초기화
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-3">
                            {winRateRows.length === 0 ? (
                                <div className="col-span-full rounded-lg border border-slate-200 bg-white py-12 text-center text-sm text-slate-500">
                                    해당 조건의 회원이 없습니다.
                                </div>
                            ) : (
                                winRateRows.map((user, index) => {
                                    const total = (user.coin_wins || 0) + (user.coin_losses || 0);
                                    const winRate = total > 0 ? ((user.coin_wins || 0) / total * 100).toFixed(1) : '0.0';
                                    return (
                                        <div key={user.id} className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm hover:border-slate-300 hover:shadow-md transition-all flex flex-col justify-between">
                                            <div>
                                                <div className="flex items-center gap-1">
                                                    <span className="text-xs font-semibold text-slate-400">#{index + 1}</span>
                                                    <div className="font-bold text-base text-slate-800 truncate" title={user.full_name || user.username || user.email}>
                                                        {user.full_name || user.username || user.email}
                                                    </div>
                                                </div>
                                                <div className="text-xs text-slate-500 mt-0.5">{formatLevelGroupLabel(normalizeLevelKey(user.skill_level))}</div>
                                            </div>
                                            <div className="mt-3 pt-2.5 border-t border-slate-100 text-center">
                                                <div className="text-xl font-black text-slate-900">{winRate}%</div>
                                                <div className="text-[10px] text-slate-400 font-medium tracking-wider uppercase mt-0.5">승률</div>
                                            </div>
                                            <div className="mt-2.5 space-y-1 text-xs">
                                                <div className="flex justify-between text-slate-500">
                                                    <span>전적</span>
                                                    <span className="font-semibold text-slate-700">
                                                        <span className="text-emerald-600">{user.coin_wins || 0}승</span>{' '}
                                                        <span className="text-rose-600">{user.coin_losses || 0}패</span>
                                                    </span>
                                                </div>
                                                <div className="flex justify-between text-slate-450 text-[11px]">
                                                    <span>총 경기수</span>
                                                    <span className="font-medium text-slate-600">{total}경기</span>
                                                </div>
                                            </div>
                                            <div className="mt-2.5 pt-2 border-t border-slate-100 flex justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => handleResetMember(user)}
                                                    disabled={isPending}
                                                    className="w-full inline-flex items-center justify-center gap-1 rounded border border-blue-200 bg-blue-50/30 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                                                >
                                                    <RotateCcw className="size-3" />
                                                    데이터 초기화
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
            )}

            {selectedTab === 'create' && (
                    <section className="rounded-lg border border-amber-200 bg-[linear-gradient(135deg,#fffaf0_0%,#fff5d6_100%)] p-4 sm:p-5">
                        <div className="max-w-4xl">
                            <h2 className="text-lg font-semibold text-amber-900">새 회원 등록</h2>
                            <p className="mt-1 hidden text-sm text-amber-800 sm:block">
                                새 회원을 등록하면 Supabase 인증(Auth) 계정과 프로필이 동시에 생성되어 즉시 로그인할 수 있습니다.
                            </p>
                        </div>
                    <div className="mt-3 grid gap-2 sm:mt-5 sm:gap-3 md:grid-cols-3">
                        <input
                            type="text"
                            value={newMember.full_name}
                            onChange={(e) => setNewMember((prev) => ({ ...prev, full_name: e.target.value }))}
                            placeholder="이름 (쉼표로 여러 명 일괄등록 가능. 예: 홍길동,김철수)"
                            className="h-11 rounded-md border border-amber-300 bg-white px-3 text-sm md:col-span-3"
                        />
                        <select
                            value={newMember.skill_level}
                            disabled={!isCurrentUserAdmin}
                            onChange={(e) => setNewMember((prev) => ({ ...prev, skill_level: e.target.value }))}
                            className="h-11 rounded-md border border-amber-300 bg-white px-3 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                        >
                            {levelOptions.map((levelCode) => {
                                const option = getLevelOptionMeta(levelCode);
                                return (
                                    <option key={levelCode} value={levelCode}>
                                        {formatAdminLevelLabel(option) || levelCode}
                                    </option>
                                );
                            })}
                        </select>
                        <select
                            value={newMember.gender}
                            onChange={(e) => setNewMember((prev) => ({ ...prev, gender: e.target.value }))}
                            className="h-11 rounded-md border border-amber-300 bg-white px-3 text-sm"
                        >
                            <option value="">성별 미지정</option>
                            <option value="M">남성</option>
                            <option value="F">여성</option>
                            <option value="O">기타</option>
                        </select>
                        <button
                            type="button"
                            onClick={handleCreateMember}
                            disabled={isPending}
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                        >
                            <UserPlus className="size-4" />
                            회원 추가
                        </button>
                    </div>
                </section>
            )}

            {selectedTab === 'rating-period' && (
                <section className="rounded-lg border border-slate-200 bg-white p-4 sm:p-5">
                    <div className="max-w-xl">
                        <h2 className="text-lg font-semibold text-slate-900">회원 상호 급수 평가 기간 설정</h2>
                        <p className="mt-1 text-sm text-slate-500">
                            회원들이 상호 급수 평가를 진행할 수 있는 기간을 설정합니다. 해당 기간에만 프로필 페이지에 평가 화면이 표시됩니다.
                        </p>
                    </div>
                    <div className="mt-5 max-w-md space-y-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-slate-700">시작 일시</label>
                            <input
                                type="datetime-local"
                                value={startDate}
                                onChange={(e) => setStartDate(e.target.value)}
                                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-slate-400 focus:outline-none"
                            />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-sm font-medium text-slate-700">종료 일시</label>
                            <input
                                type="datetime-local"
                                value={endDate}
                                onChange={(e) => setEndDate(e.target.value)}
                                className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-slate-400 focus:outline-none"
                            />
                        </div>
                        <div className="pt-2 flex gap-2">
                            <button
                                type="button"
                                onClick={handleSaveSettings}
                                disabled={isSavingSettings || isPending}
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
                            >
                                <Save className="size-4" />
                                설정 저장
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStartDate('');
                                    setEndDate('');
                                }}
                                className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                            >
                                기간 초기화 (비활성화)
                            </button>
                        </div>
                    </div>
                </section>
            )}
        </div>
    );
}

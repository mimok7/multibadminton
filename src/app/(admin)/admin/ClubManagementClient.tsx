'use client';

import { useState, useTransition } from 'react';
import { Plus, Settings, Users, Calendar, X, ArrowRight } from 'lucide-react';
import { createClub, updateClub, deleteClub, getClubManagers, searchUsers, addClubManager, removeClubManager } from './actions';
import { setActiveClubAction } from '@/app/actions/club';
import { useRouter } from 'next/navigation';

interface Club {
    id: string;
    name: string;
    code: string;
    description: string | null;
    phone?: string | null;
    address?: string | null;
    manager_name?: string | null;
    created_at: string;
    member_count: number;
}

export default function ClubManagementClient({ initialClubs }: { initialClubs: Club[] }) {
    const router = useRouter();
    const [clubs] = useState<Club[]>(initialClubs);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isManagerModalOpen, setIsManagerModalOpen] = useState(false);
    const [selectedClub, setSelectedClub] = useState<Club | null>(null);
    const [clubManagers, setClubManagers] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    
    // Create Club state
    const [newClub, setNewClub] = useState({ name: '', code: '', description: '', phone: '', address: '', manager_name: '' });
    
    // Edit Club state
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingClub, setEditingClub] = useState({ id: '', name: '', code: '', description: '', phone: '', address: '', manager_name: '' });

    const [isPending, startTransition] = useTransition();

    const handleCreateClub = () => {
        if (!newClub.name.trim() || !newClub.code.trim()) {
            alert('클럽 이름과 코드를 모두 입력해 주세요.');
            return;
        }

        startTransition(async () => {
            const result = await createClub(newClub);
            if (result.error) {
                alert(`클럽 생성 실패: ${result.error}`);
            } else {
                if (result.warning) alert(result.warning);
                else alert('클럽이 성공적으로 생성되었습니다.');
                setIsCreateModalOpen(false);
                setNewClub({ name: '', code: '', description: '', phone: '', address: '', manager_name: '' });
                router.refresh();
            }
        });
    };

    const handleUpdateClub = () => {
        if (!editingClub.name.trim() || !editingClub.code.trim()) {
            alert('클럽 이름과 코드를 모두 입력해 주세요.');
            return;
        }

        startTransition(async () => {
            const result = await updateClub(editingClub.id, editingClub);
            if (result.error) {
                alert(`클럽 수정 실패: ${result.error}`);
            } else {
                if (result.warning) alert(result.warning);
                else alert('클럽이 성공적으로 수정되었습니다.');
                setIsEditModalOpen(false);
                router.refresh();
            }
        });
    };

    const handleDeleteClub = (club: Club) => {
        if (!confirm(`정말로 '${club.name}' 클럽을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;

        startTransition(async () => {
            const result = await deleteClub(club.id);
            if (result.error) {
                alert(`클럽 삭제 실패: ${result.error}`);
            } else {
                alert('클럽이 삭제되었습니다.');
                router.refresh();
            }
        });
    };

    const handleOpenManagerSetting = (club: Club) => {
        setSelectedClub(club);
        setSearchQuery('');
        setSearchResults([]);
        startTransition(async () => {
            const result = await getClubManagers(club.id);
            if (result.error) {
                alert(`매니저 정보를 불러오는 중 오류가 발생했습니다: ${result.error}`);
            } else {
                setClubManagers(result.managers || []);
                setIsManagerModalOpen(true);
            }
        });
    };

    const executeSearch = async () => {
        if (searchQuery.trim().length < 2 || !selectedClub) {
            setSearchResults([]);
            return;
        }
        setIsSearching(true);
        const result = await searchUsers(selectedClub.id, searchQuery);
        setIsSearching(false);
        if (result.users) {
            setSearchResults(result.users);
        }
    };

    const handleAddManager = (userId: string) => {
        if (!selectedClub) return;
        
        if (clubManagers.some((m) => m.user_id === userId)) {
            alert('이미 이 클럽의 매니저로 등록된 사용자입니다.');
            return;
        }

        startTransition(async () => {
            const result = await addClubManager(selectedClub.id, userId);
            if (result.error) {
                alert(`매니저 추가 실패: ${result.error}`);
            } else {
                const reload = await getClubManagers(selectedClub.id);
                setClubManagers(reload.managers || []);
                setSearchQuery('');
                setSearchResults([]);
            }
        });
    };

    const handleRemoveManager = (userId: string) => {
        if (!selectedClub) return;
        if (!confirm('정말로 이 사용자의 매니저 권한을 해제하시겠습니까?')) return;

        startTransition(async () => {
            const result = await removeClubManager(selectedClub.id, userId);
            if (result.error) {
                alert(`매니저 해제 실패: ${result.error}`);
            } else {
                const reload = await getClubManagers(selectedClub.id);
                setClubManagers(reload.managers || []);
            }
        });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">클럽 관리</h1>
                    <p className="text-sm text-slate-500">배드민턴 매치 메이커 서비스에 등록된 모든 클럽을 관리합니다.</p>
                </div>
                <button
                    onClick={() => {
                        setNewClub({ name: '', code: Math.random().toString(36).substring(2, 8).toUpperCase(), description: '', phone: '', address: '', manager_name: '' });
                        setIsCreateModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition"
                >
                    <Plus className="size-4" />
                    새 클럽 추가
                </button>
            </div>

            {/* Clubs Grid/Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">클럽 이름</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">담당자/연락처</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">설명</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">회원 수</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">생성일</th>
                            <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">설정</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {clubs.map((club) => (
                            <tr key={club.id} className="hover:bg-slate-50/80 transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-slate-900">{club.name}</span>
                                        <span className="text-xs text-slate-500 mt-0.5">코드: {club.code}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex flex-col text-sm text-slate-600">
                                        <span>{club.manager_name || '미지정'}</span>
                                        {club.phone && <span className="text-xs text-slate-400 mt-0.5">{club.phone}</span>}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-slate-600 text-sm max-w-xs truncate">
                                    {club.description || '-'}
                                </td>
                                <td className="px-6 py-4 text-slate-600 text-sm">
                                    <div className="flex items-center gap-1.5">
                                        <Users className="size-4 text-slate-400" />
                                        <span>{club.member_count} 명</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-slate-600 text-sm">
                                    <div className="flex items-center gap-1.5">
                                        <Calendar className="size-4 text-slate-400" />
                                        <span>{new Date(club.created_at).toLocaleDateString()}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button
                                            onClick={async () => {
                                                const managerTab = window.open('about:blank', '_blank');
                                                const result = await setActiveClubAction(club.id);
                                                if (!result.success) {
                                                    managerTab?.close();
                                                    alert(result.error || '매니저 화면을 열 수 없습니다.');
                                                    return;
                                                }
                                                if (managerTab) {
                                                    managerTab.opener = null;
                                                    managerTab.location.href = '/manager';
                                                } else {
                                                    alert('새 탭이 차단되었습니다. 브라우저의 팝업 허용 후 다시 시도해 주세요.');
                                                }
                                            }}
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition"
                                        >
                                            <ArrowRight className="size-3.5" />
                                            매니저 화면
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingClub({
                                                    id: club.id,
                                                    name: club.name,
                                                    code: club.code,
                                                    description: club.description || '',
                                                    phone: club.phone || '',
                                                    address: club.address || '',
                                                    manager_name: club.manager_name || '',
                                                });
                                                setIsEditModalOpen(true);
                                            }}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
                                        >
                                            <Settings className="size-3.5 text-slate-400" />
                                            수정
                                        </button>
                                        <button
                                            onClick={() => handleOpenManagerSetting(club)}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition"
                                        >
                                            <Users className="size-3.5 text-slate-400" />
                                            매니저 설정
                                        </button>
                                        <button
                                            onClick={() => handleDeleteClub(club)}
                                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-100 transition"
                                        >
                                            <X className="size-3.5 text-red-500" />
                                            삭제
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Create Club Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-slate-100 p-6">
                            <h2 className="text-lg font-bold text-slate-900">새 클럽 추가</h2>
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 transition"
                            >
                                <X className="size-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">클럽 이름</label>
                                <input
                                    type="text"
                                    value={newClub.name}
                                    onChange={(e) => setNewClub({ ...newClub, name: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="예: 강남 배드민턴 클럽"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">클럽 코드 (중복 불가)</label>
                                <input
                                    type="text"
                                    value={newClub.code}
                                    onChange={(e) => setNewClub({ ...newClub, code: e.target.value.toUpperCase() })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="예: GANGNAM (영문 대문자)"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">담당자 명 (선택)</label>
                                    <input
                                        type="text"
                                        value={newClub.manager_name}
                                        onChange={(e) => setNewClub({ ...newClub, manager_name: e.target.value })}
                                        className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        placeholder="홍길동"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">연락처 (선택)</label>
                                    <input
                                        type="text"
                                        value={newClub.phone}
                                        onChange={(e) => setNewClub({ ...newClub, phone: e.target.value })}
                                        className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        placeholder="010-0000-0000"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">주소 (선택)</label>
                                <input
                                    type="text"
                                    value={newClub.address}
                                    onChange={(e) => setNewClub({ ...newClub, address: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="체육관 주소"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">설명 (선택)</label>
                                <textarea
                                    value={newClub.description}
                                    onChange={(e) => setNewClub({ ...newClub, description: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 h-20 resize-none"
                                    placeholder="클럽에 대한 짧은 설명을 적어주세요."
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
                            <button
                                onClick={() => setIsCreateModalOpen(false)}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleCreateClub}
                                disabled={isPending}
                                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50"
                            >
                                {isPending ? '생성 중...' : '클럽 생성'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manager Setting Modal */}
            {isManagerModalOpen && selectedClub && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-slate-100 p-6">
                            <div>
                                <h2 className="text-lg font-bold text-slate-900">[{selectedClub.name}] 매니저 설정</h2>
                                <p className="text-xs text-slate-500 mt-0.5">클럽을 관리할 매니저를 지정하고 해제합니다.</p>
                            </div>
                            <button
                                onClick={() => setIsManagerModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 transition"
                            >
                                <X className="size-5" />
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-6">
                            {/* 현재 매니저 목록 */}
                            <div>
                                <h3 className="text-sm font-bold text-slate-700 mb-2">지정된 매니저 목록</h3>
                                {clubManagers.length === 0 ? (
                                    <div className="text-center py-4 border border-dashed border-slate-200 rounded-lg text-sm text-slate-400">
                                        등록된 매니저가 없습니다.
                                    </div>
                                ) : (
                                    <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                                        {clubManagers.map((manager) => (
                                            <div key={manager.user_id} className="flex items-center justify-between px-4 py-3 bg-slate-50/50">
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-semibold text-slate-950">
                                                        {manager.full_name || manager.username || '이름 없음'}
                                                    </span>
                                                    <span className="text-xs text-slate-500">{manager.email}</span>
                                                </div>
                                                <button
                                                    onClick={() => handleRemoveManager(manager.user_id)}
                                                    className="rounded px-2.5 py-1 text-xs font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                                                >
                                                    해제
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* 새로운 매니저 임명 (사용자 검색) */}
                            <div className="pt-4 border-t border-slate-100">
                                <h3 className="text-sm font-bold text-slate-700 mb-2">새로운 매니저 지정 (사용자 검색)</h3>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                executeSearch();
                                            }
                                        }}
                                        placeholder="이름 또는 이메일 검색 (2자 이상)"
                                        className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    />
                                    <button
                                        onClick={executeSearch}
                                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition whitespace-nowrap"
                                    >
                                        검색
                                    </button>
                                </div>
                                
                                {isSearching && (
                                    <div className="text-center py-3 text-xs text-slate-400">검색 중...</div>
                                )}

                                {!isSearching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
                                    <div className="text-center py-3 text-xs text-slate-400">검색 결과가 없습니다.</div>
                                )}

                                {!isSearching && searchResults.length > 0 && (
                                    <div className="mt-2 max-h-40 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
                                        {searchResults.map((user) => (
                                            <div key={user.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-semibold text-slate-800">
                                                        {user.full_name || user.username || '이름 없음'}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500">{user.email}</span>
                                                </div>
                                                <button
                                                    onClick={() => handleAddManager(user.id)}
                                                    className="rounded px-2.5 py-1 text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
                                                >
                                                    임명
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center justify-end border-t border-slate-100 bg-slate-50 px-6 py-4">
                            <button
                                onClick={() => setIsManagerModalOpen(false)}
                                className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800 transition"
                            >
                                닫기
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Edit Club Modal */}
            {isEditModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between border-b border-slate-100 p-6">
                            <h2 className="text-lg font-bold text-slate-900">클럽 정보 수정</h2>
                            <button
                                onClick={() => setIsEditModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 transition"
                            >
                                <X className="size-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">클럽 이름</label>
                                <input
                                    type="text"
                                    value={editingClub.name}
                                    onChange={(e) => setEditingClub({ ...editingClub, name: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="예: 강남 배드민턴 클럽"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">클럽 코드 (중복 불가)</label>
                                <input
                                    type="text"
                                    value={editingClub.code}
                                    onChange={(e) => setEditingClub({ ...editingClub, code: e.target.value.toUpperCase() })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="예: GANGNAM (영문 대문자)"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">담당자 명 (선택)</label>
                                    <input
                                        type="text"
                                        value={editingClub.manager_name}
                                        onChange={(e) => setEditingClub({ ...editingClub, manager_name: e.target.value })}
                                        className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        placeholder="홍길동"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">연락처 (선택)</label>
                                    <input
                                        type="text"
                                        value={editingClub.phone}
                                        onChange={(e) => setEditingClub({ ...editingClub, phone: e.target.value })}
                                        className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                        placeholder="010-0000-0000"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">주소 (선택)</label>
                                <input
                                    type="text"
                                    value={editingClub.address}
                                    onChange={(e) => setEditingClub({ ...editingClub, address: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    placeholder="체육관 주소"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">설명 (선택)</label>
                                <textarea
                                    value={editingClub.description}
                                    onChange={(e) => setEditingClub({ ...editingClub, description: e.target.value })}
                                    className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 h-20 resize-none"
                                    placeholder="클럽에 대한 짧은 설명을 적어주세요."
                                />
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
                            <button
                                onClick={() => setIsEditModalOpen(false)}
                                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                            >
                                취소
                            </button>
                            <button
                                onClick={handleUpdateClub}
                                disabled={isPending}
                                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition disabled:opacity-50"
                            >
                                {isPending ? '수정 중...' : '수정 완료'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

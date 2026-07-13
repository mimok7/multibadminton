'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useUser } from '@/hooks/useUser';
import { useClub } from '@/hooks/useClub';
import { getSupabaseClient } from '@/lib/supabase';
import { Bell } from 'lucide-react';

export default function Header() {
  const { user } = useUser();
  const { clubId } = useClub();
  const supabase = getSupabaseClient();
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeClub, setActiveClub] = useState<{name: string} | null>(null);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      setActiveClub(null);
      return;
    }

    const fetchActiveClub = async () => {
      try {
        const res = await fetch('/api/user/active-club');
        if (res.ok) {
          const { club } = await res.json();
          setActiveClub(club);
        }
    } catch {
        // ignore
      }
    };
    fetchActiveClub();

    const fetchUnread = async () => {
      try {
        const res = await fetch('/api/user/notifications?summary=1', { cache: 'no-store' });
        if (!res.ok) return;
        const { unreadCount } = await res.json();
        setUnreadCount(Number(unreadCount) || 0);
      } catch {
        setUnreadCount(0);
      }
    };

    fetchUnread();

    // 실시간 구독 (알림 삽입/업데이트 시 카운트 갱신)
    const channel = supabase.channel('user-notifications-header')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`
      }, (payload: any) => {
        // Only refresh if the notification belongs to the active club
        if (payload.new?.club_id && payload.new.club_id !== clubId) return;
        fetchUnread();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, clubId, supabase]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/75">
      <nav className="mx-auto flex h-12 w-full max-w-[1600px] items-center justify-between px-3 sm:px-4 lg:px-6">
        <div className="flex items-center">
          <Link href="/dashboard" className="flex items-center hover:opacity-80">
            <Image 
              src="/badminton.png" 
              alt="Badminton Logo" 
              width={28} 
              height={28}
              sizes="28px"
              priority
              suppressHydrationWarning
            />
            <span className="ml-2 text-sm font-semibold leading-none w-max">{activeClub?.name || '배드민턴'}</span>
          </Link>
        </div>

        {user && (
          <div className="flex items-center gap-3">
            {activeClub && (
              <Link href="/select-club" className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-full text-xs font-semibold text-slate-700 transition-colors">
                <span className="truncate max-w-[100px]">{activeClub.name}</span>
                <span className="text-[10px] text-slate-500 bg-white px-1.5 py-0.5 rounded-full shadow-sm">변경</span>
              </Link>
            )}
            
            <Link href="/notifications" className="relative flex items-center justify-center w-9 h-9 rounded-full hover:bg-slate-100 transition-colors text-slate-600">
              <Bell className="size-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white shadow-sm ring-2 ring-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          </div>
        )}
      </nav>
    </header>
  );
}

'use client';

import { useState, useEffect } from 'react';

interface ClubContextData {
  clubId: string | null;
  clubName: string | null;
  clubRole: string | null;
  clubMember: any | null;
  loading: boolean;
  error: Error | null;
}

export function useClub(): ClubContextData {
  const [data, setData] = useState<ClubContextData>({
    clubId: null,
    clubName: null,
    clubRole: null,
    clubMember: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchClubInfo() {
      try {
        // API를 통해 클럽 정보 및 권한 조회 (서버가 HttpOnly 쿠키를 처리함)
        const res = await fetch('/api/user/active-club');
        if (!res.ok) {
          throw new Error('Failed to fetch active club');
        }

        const json = await res.json();
        const activeClubId = json.club?.id || null;

        if (!activeClubId) {
          if (isMounted) {
            setData(prev => ({ ...prev, clubId: null, clubName: null, clubRole: null, clubMember: null, loading: false }));
          }
          return;
        }

        if (isMounted) {
          setData({
            clubId: activeClubId,
            clubName: json.club?.name || null,
            clubRole: json.clubRole || null,
            clubMember: json.member || null,
            loading: false,
            error: null,
          });
        }
      } catch (err: any) {
        console.error('Error in useClub:', err);
        if (isMounted) {
          setData(prev => ({
            ...prev,
            loading: false,
            error: err,
          }));
        }
      }
    }

    fetchClubInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  return data;
}

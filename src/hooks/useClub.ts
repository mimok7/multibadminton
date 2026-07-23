'use client';

import { useCallback, useEffect, useState } from 'react';

interface ClubContextData {
  clubId: string | null;
  clubName: string | null;
  clubRole: string | null;
  clubMember: any | null;
  loading: boolean;
  error: Error | null;
  refreshClub: () => Promise<void>;
}

type ClubData = Omit<ClubContextData, 'refreshClub'>;

const CLUB_CACHE_DURATION_MS = 30 * 1000;
const EMPTY_CLUB_DATA: ClubData = {
  clubId: null,
  clubName: null,
  clubRole: null,
  clubMember: null,
  loading: true,
  error: null,
};

let cachedClubData: ClubData | null = null;
let cachedAt = 0;
let pendingClubRequest: Promise<ClubData> | null = null;
const clubListeners = new Set<(data: ClubData) => void>();

function publishClubData(data: ClubData) {
  cachedClubData = data;
  cachedAt = Date.now();
  clubListeners.forEach((listener) => listener(data));
}

async function requestClubData(force = false): Promise<ClubData> {
  if (
    !force &&
    cachedClubData &&
    Date.now() - cachedAt < CLUB_CACHE_DURATION_MS
  ) {
    return cachedClubData;
  }

  if (!force && pendingClubRequest) {
    return pendingClubRequest;
  }

  pendingClubRequest = fetch('/api/user/active-club', {
    credentials: 'include',
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('Failed to fetch active club');
      }

      const json = await response.json();
      return {
        clubId: json.club?.id || null,
        clubName: json.club?.name || null,
        clubRole: json.clubRole || null,
        clubMember: json.member || null,
        loading: false,
        error: null,
      } satisfies ClubData;
    })
    .then((data) => {
      publishClubData(data);
      return data;
    })
    .catch((error: unknown) => {
      const nextData: ClubData = {
        ...(cachedClubData || EMPTY_CLUB_DATA),
        loading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
      publishClubData(nextData);
      return nextData;
    })
    .finally(() => {
      pendingClubRequest = null;
    });

  return pendingClubRequest;
}

export function invalidateClubCache() {
  cachedClubData = null;
  cachedAt = 0;
  pendingClubRequest = null;
}

export function useClub(): ClubContextData {
  const [data, setData] = useState<ClubData>(
    cachedClubData || EMPTY_CLUB_DATA
  );

  useEffect(() => {
    let isMounted = true;
    const listener = (nextData: ClubData) => {
      if (isMounted) setData(nextData);
    };

    clubListeners.add(listener);
    void requestClubData().then(listener);

    return () => {
      isMounted = false;
      clubListeners.delete(listener);
    };
  }, []);

  const refreshClub = useCallback(async () => {
    const nextData = await requestClubData(true);
    setData(nextData);
  }, []);

  return { ...data, refreshClub };
}

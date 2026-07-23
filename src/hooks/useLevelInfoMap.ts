'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { fetchLevelInfoMap, type LevelInfoMap } from '@/lib/level-info';

let cachedLevelInfoMap: LevelInfoMap | null = null;
let pendingLevelInfoMap: Promise<LevelInfoMap> | null = null;

export function useLevelInfoMap() {
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [levelInfoMap, setLevelInfoMap] = useState<LevelInfoMap>(cachedLevelInfoMap || {});

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (cachedLevelInfoMap && Object.keys(cachedLevelInfoMap).length > 0) {
        setLevelInfoMap(cachedLevelInfoMap);
        return;
      }

      try {
        if (!pendingLevelInfoMap) {
          pendingLevelInfoMap = fetchLevelInfoMap(supabase).finally(() => {
            pendingLevelInfoMap = null;
          });
        }
        const nextMap = await pendingLevelInfoMap;
        cachedLevelInfoMap = nextMap;

        if (active) {
          setLevelInfoMap(nextMap);
        }
      } catch (error) {
        console.error('레벨 정보 조회 오류:', error);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [supabase]);

  return levelInfoMap;
}

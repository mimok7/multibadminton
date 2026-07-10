import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { CLUB_SCOPED_TABLES, normalizeClubId } from '@/lib/club-scope';

type BrowserSupabaseClient = SupabaseClient<Database>;

let supabaseInstance: BrowserSupabaseClient | null = null;
let cachedActiveClubId: string | null | undefined = undefined;
const serverSupabasePlaceholder = {} as BrowserSupabaseClient;

export const getSupabaseClient = (): BrowserSupabaseClient => {
  if (typeof window === 'undefined') {
    // Client components are still pre-rendered on the server in Next.js.
    // Avoid constructing a browser client until we are actually in the browser.
    return serverSupabasePlaceholder;
  }

  // active_club_id 쿠키 읽기
  let activeClubId: string | null = null;
  const match = document.cookie.match(/(?:^|;\s*)active_club_id=([^;]*)/);
  if (match) {
    activeClubId = normalizeClubId(match[1]);
  }

  // 인스턴스가 존재하고 캐싱된 클럽 ID가 현재 쿠키와 같으면 재사용
  if (supabaseInstance && cachedActiveClubId === activeClubId) {
    return supabaseInstance;
  }

  if (supabaseInstance && cachedActiveClubId !== activeClubId) {
    void supabaseInstance.removeAllChannels();
  }

  try {
    window.localStorage.removeItem('badminton-auth-token');
  } catch {
    // Ignore localStorage access errors in restricted browsers.
  }

  const client = createBrowserClient<Database, 'public'>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: activeClubId ? { headers: { 'x-club-id': activeClubId } } : undefined,
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    }
  ) as unknown as BrowserSupabaseClient;

  if (activeClubId) {
    const originalFrom = client.from.bind(client);
    (client as any).from = (table: string) => {
      const qb = originalFrom(table as any);

      if (CLUB_SCOPED_TABLES.has(table)) {
        // select, update, delete 체이닝 인터셉트
        const methodsToIntercept = ['select', 'update', 'delete'];
        methodsToIntercept.forEach(method => {
          if (typeof (qb as any)[method] === 'function') {
            const originalMethod = (qb as any)[method].bind(qb);
            (qb as any)[method] = (...args: any[]) => {
              const filterBuilder = originalMethod(...args);
              return filterBuilder.eq('club_id', activeClubId);
            };
          }
        });

        // insert, upsert 페이로드 인터셉트
        ['insert', 'upsert'].forEach(method => {
          if (typeof (qb as any)[method] === 'function') {
            const originalMethod = (qb as any)[method].bind(qb);
            (qb as any)[method] = (data: any, ...args: any[]) => {
              let modifiedData = data;
              if (Array.isArray(data)) {
                modifiedData = data.map(d => ({ ...d, club_id: activeClubId }));
              } else if (data && typeof data === 'object') {
                modifiedData = { ...data, club_id: activeClubId };
              }
              return originalMethod(modifiedData, ...args);
            };
          }
        });
      }

      return qb;
    };
  }

  supabaseInstance = client;
  cachedActiveClubId = activeClubId;
  return supabaseInstance;
};

export const supabase = new Proxy({} as BrowserSupabaseClient, {
  get(_target, property, receiver) {
    return Reflect.get(getSupabaseClient(), property, receiver);
  },
});

export const createOptimizedBrowserClient = getSupabaseClient;

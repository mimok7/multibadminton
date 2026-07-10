import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '@/types/supabase';
import { CLUB_SCOPED_TABLES, normalizeClubId } from '@/lib/club-scope';

type ServerSupabaseClient = ReturnType<typeof createServerClient<Database>>;
type AdminSupabaseClient = ReturnType<typeof createClient<Database>>;
let globalAdminClient: AdminSupabaseClient | null = null;

function createAdminClient(): AdminSupabaseClient {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

export function withClubFilter(client: any, activeClubId: string | undefined | null) {
  if (!activeClubId) {
    throw new Error('활성 클럽이 선택되지 않았습니다.');
  }

  const originalFrom = client.from.bind(client);

  client.from = (table: string) => {
    const qb = originalFrom(table);

    if (CLUB_SCOPED_TABLES.has(table)) {
      // 1. select, update, delete 체이닝 인터셉트
      const methodsToIntercept = ['select', 'update', 'delete'];
      methodsToIntercept.forEach(method => {
        if (typeof qb[method] === 'function') {
          const originalMethod = qb[method].bind(qb);
          qb[method] = (...args: any[]) => {
            const filterBuilder = originalMethod(...args);
            return filterBuilder.eq('club_id', activeClubId);
          };
        }
      });

      // 2. insert, upsert 페이로드 인터셉트
      ['insert', 'upsert'].forEach(method => {
        if (typeof qb[method] === 'function') {
          const originalMethod = qb[method].bind(qb);
          qb[method] = (data: any, ...args: any[]) => {
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

  return client;
}

export async function getSupabaseServerClient(): Promise<ServerSupabaseClient> {
  const cookieStore = await cookies();
  const activeClubId = normalizeClubId(cookieStore.get('active_club_id')?.value);

  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: activeClubId ? { headers: { 'x-club-id': activeClubId } } : undefined,
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components may not be able to write cookies.
          }
        },
      },
    }
  );

  // 세션 확인처럼 클럽과 무관한 Auth API는 활성 클럽 없이도 사용할 수 있어야 한다.
  return activeClubId ? withClubFilter(client, activeClubId) : client;
}

export async function getUnfilteredSupabaseServerClient(): Promise<ServerSupabaseClient> {
  const cookieStore = await cookies();
  const client = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components may not be able to write cookies.
          }
        },
      },
    }
  );
  return client;
}

export function getUnfilteredGlobalAdminClient(): AdminSupabaseClient {
  if (!globalAdminClient) {
    globalAdminClient = createAdminClient();
  }
  return globalAdminClient;
}

export async function getFilteredAdminClient(): Promise<AdminSupabaseClient> {
  const cookieStore = await cookies();
  const activeClubId = normalizeClubId(cookieStore.get('active_club_id')?.value);
  // 필터 래퍼는 client.from을 수정하므로 요청 간 클럽 범위가 섞이지 않게 전용 인스턴스를 사용한다.
  const adminClient = createAdminClient();
  return withClubFilter(adminClient, activeClubId) as AdminSupabaseClient;
}

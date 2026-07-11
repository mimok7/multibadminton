import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  ADMIN_ROUTE_PREFIXES,
  MANAGER_ROUTE_PREFIXES,
  AUTH_ROUTE_PREFIXES,
  DEFAULT_ADMIN_REDIRECT,
  DEFAULT_USER_REDIRECT,
  matchesRoutePrefix,
} from '@/lib/route-access';
import { getUserRole, getRoleFromUser } from '@/lib/auth';
import { normalizeClubId } from '@/lib/club-scope';

import type { NextRequest } from 'next/server';

// 클럽 역할은 시스템 역할이 user인 클럽 매니저도 확인할 수 있어야 합니다.
// 미들웨어의 일반 클라이언트는 RLS에 의해 club_members 행을 읽지 못할 수
// 있으므로, 사용자와 활성 클럽을 모두 조건으로 고정한 서버 전용 REST 조회를 사용합니다.
async function getClubRoleForMiddleware(userId: string, clubId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) return null;

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };

  const profileUrl = new URL('/rest/v1/profiles', baseUrl);
  profileUrl.searchParams.set('select', 'id');
  profileUrl.searchParams.set('or', `(user_id.eq.${userId},id.eq.${userId})`);
  profileUrl.searchParams.set('limit', '1');
  const profileResponse = await fetch(profileUrl, { headers, cache: 'no-store' });
  if (!profileResponse.ok) return null;
  const profiles = (await profileResponse.json()) as Array<{ id?: string }>;
  const profileId = profiles[0]?.id;
  if (!profileId) return null;

  const memberUrl = new URL('/rest/v1/club_members', baseUrl);
  memberUrl.searchParams.set('select', 'role');
  memberUrl.searchParams.set('user_id', `eq.${profileId}`);
  memberUrl.searchParams.set('club_id', `eq.${clubId}`);
  memberUrl.searchParams.set('status', 'eq.active');
  memberUrl.searchParams.set('limit', '1');
  const memberResponse = await fetch(memberUrl, { headers, cache: 'no-store' });
  if (!memberResponse.ok) return null;
  const members = (await memberResponse.json()) as Array<{ role?: string | null }>;
  return members[0]?.role ?? null;
}

async function isSuperadminForMiddleware(userId: string) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) return false;

  const profileUrl = new URL('/rest/v1/profiles', baseUrl);
  profileUrl.searchParams.set('select', 'role,username');
  profileUrl.searchParams.set('or', `(user_id.eq.${userId},id.eq.${userId})`);
  profileUrl.searchParams.set('limit', '1');

  const response = await fetch(profileUrl, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    cache: 'no-store',
  });
  if (!response.ok) return false;

  const profiles = (await response.json()) as Array<{ role?: string | null; username?: string | null }>;
  const profile = profiles[0];
  return profile?.role?.trim().toLowerCase() === 'superadmin'
    || profile?.username?.trim() === '슈퍼관리자'
    || profile?.username?.trim() === '관리자';
}

function shouldRequirePasswordChange(value: unknown) {
  return value === true || value === 'true';
}

// Paths that must never be redirected (utility / escape-hatch routes)
const REDIRECT_SAFE_PATHS = new Set([
  '/select-club',
  '/unauthorized',
  '/change-password',
  '/login',
  '/signup',
  '/superadmin/login',
  '/maintenance',
]);

export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  req.headers.set('x-pathname', pathname);

  const res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });

  // 빌드 타임 프리렌더링 시 미들웨어 리다이렉션으로 인해 번들 수집이 실패하는 문제를 방지합니다.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return res;
  }

  // 점검 모드 설정 확인
  const isMaintenanceMode = process.env.NEXT_PUBLIC_MAINTENANCE_MODE === 'true';
  const isMaintenancePath = pathname === '/maintenance';
  const isApiOrStatic = pathname.startsWith('/api') || 
                        pathname.startsWith('/_next') || 
                        pathname.startsWith('/favicon.ico') || 
                        pathname.includes('.');

  // 점검 모드가 비활성화되어 있는데 /maintenance로 접근하는 경우 홈(/)으로 리다이렉트
  if (!isMaintenanceMode && isMaintenancePath) {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // API나 정적 리소스는 점검 모드 제외
  if (isApiOrStatic) {
    return res;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const isAdminRoute = matchesRoutePrefix(pathname, ADMIN_ROUTE_PREFIXES);
  const isManagerRoute = matchesRoutePrefix(pathname, MANAGER_ROUTE_PREFIXES);
  const isProtectedPath = isAdminRoute || isManagerRoute;
  const isAuthRoute = matchesRoutePrefix(pathname, AUTH_ROUTE_PREFIXES);

  // 세션 쿠키 존재 여부 검사 (보통 sb-[project-ref]-auth-token 형식)
  const hasSessionCookie = req.cookies.getAll().some(
    (cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token')
  );

  // 점검 모드이고 세션 쿠키가 없는 경우, /login을 제외하고 모두 /maintenance로 리다이렉션
  if (isMaintenanceMode && !hasSessionCookie) {
    if (pathname !== '/login' && !isMaintenancePath) {
      const url = req.nextUrl.clone();
      url.pathname = '/maintenance';
      return NextResponse.redirect(url);
    }
    return res;
  }

  // 세션 쿠키가 없고 보호된 경로가 아닌 경우, 인증 조회(getUser)를 스킵하고 바로 통과시킵니다.
  if (!hasSessionCookie && !isProtectedPath) {
    return res;
  }

  // 전용 인증 화면은 세션이 없어도 렌더링할 수 있어야 한다.
  if (!hasSessionCookie && isAuthRoute) {
    return res;
  }

  // 만약 세션 쿠키가 없고 보호된 경로라면, 바로 로그인으로 리다이렉트합니다.
  if (!hasSessionCookie && isProtectedPath) {
    const url = req.nextUrl.clone();
    url.pathname = pathname === '/superadmin' || pathname.startsWith('/superadmin/')
      ? '/superadmin/login'
      : '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    // 점검 모드이고 유저가 로그인 상태인 경우
    if (isMaintenanceMode && user) {
      const role = await getUserRole(supabase, user);
      const isSuperUser = role === 'admin' || role === 'manager';

      // 어드민이나 매니저가 아니면서 /maintenance가 아닌 경로에 있으면 점검 화면으로 강제 이동
      if (!isSuperUser && !isMaintenancePath) {
        const url = req.nextUrl.clone();
        url.pathname = '/maintenance';
        return NextResponse.redirect(url);
      }
    }
    
    // change-password 페이지는 언제나 접근 가능
    if (pathname === '/change-password') {
      return res;
    }

    const mustChangePassword = shouldRequirePasswordChange(
      user?.user_metadata?.must_change_password
    );

    if (user && mustChangePassword) {
      const url = req.nextUrl.clone();
      url.pathname = '/change-password';
      return NextResponse.redirect(url);
    }

    if (user && isAuthRoute) {
      const role = getRoleFromUser(user);
      const url = req.nextUrl.clone();
      if (role === 'admin') {
        url.pathname = DEFAULT_ADMIN_REDIRECT;
      } else if (role === 'manager') {
        url.pathname = '/manager';
      } else {
        url.pathname = DEFAULT_USER_REDIRECT;
      }
      return NextResponse.redirect(url);
    }

    // 보호된 경로가 아니면 통과
    if (!isProtectedPath) {
      return res;
    }

    // 보호된 경로인데 인증 실패
    if (userError || !user) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(url);
    }

    const role = await getUserRole(supabase, user);
    const isGlobalAdmin = role === 'admin' || await isSuperadminForMiddleware(user.id);
    const isSystemManager = role === 'manager';
    // ──────────────────────────────────────────────
    // 1. 관리자 전용 라우트 (/admin, /admin-setup)
    // ──────────────────────────────────────────────
    if (isAdminRoute) {
      if (!isGlobalAdmin) {
        const url = req.nextUrl.clone();
        url.pathname = '/unauthorized';
        return NextResponse.redirect(url);
      }
      // 시스템 관리자 → 프리패스 (클럽 쿠키 불필요)
      return res;
    }

    // ──────────────────────────────────────────────
    // 2. 매니저 라우트 (/manager, /match-schedule, /players, etc.)
    // ──────────────────────────────────────────────
    if (isManagerRoute) {
      // 시스템 관리자 → 모든 매니저 페이지 접근 가능 (프리패스)
      if (isGlobalAdmin) return res;

      // 전체 클럽 관리는 슈퍼관리자 전용이다. 매니저의 /manager/admin 접근도 차단한다.
      if (pathname === '/manager/admin' || pathname.startsWith('/manager/admin/')) {
        const url = req.nextUrl.clone();
        url.pathname = '/unauthorized';
        return NextResponse.redirect(url);
      }

      // 시스템 매니저 → 클럽 선택 없이도 일반 매니저 홈에 접근 가능
      const activeClubId = normalizeClubId(req.cookies.get('active_club_id')?.value);
      const hasClubCookie = Boolean(activeClubId);
      const isGlobalAdminPath = pathname === '/manager';

      if (isSystemManager) {
        if (hasClubCookie || isGlobalAdminPath) {
          return res;
        }
        // 시스템 매니저이지만 클럽별 관리 페이지에 클럽 쿠키 없이 접근
        if (!REDIRECT_SAFE_PATHS.has(pathname)) {
          const url = req.nextUrl.clone();
          url.pathname = '/select-club';
          url.searchParams.set('redirectTo', pathname);
          return NextResponse.redirect(url);
        }
        return res;
      }

      // 일반 사용자 (클럽 레벨 매니저 후보)
      // 클럽 쿠키가 없으면 클럽 선택 페이지로 보냄
      if (!hasClubCookie) {
        if (!REDIRECT_SAFE_PATHS.has(pathname)) {
          const url = req.nextUrl.clone();
          url.pathname = '/select-club';
          url.searchParams.set('redirectTo', pathname);
          return NextResponse.redirect(url);
        }
        return res;
      }

      // 클럽 쿠키가 있으면 해당 클럽에서의 역할을 확인
      if (activeClubId) {
        const clubRole = await getClubRoleForMiddleware(user.id, activeClubId);
        if (!clubRole || !['owner', 'admin', 'manager'].includes(clubRole)) {
          console.log('[Middleware] Redirecting to /unauthorized', { activeClubId, clubRole, userId: user.id });
          const url = req.nextUrl.clone();
          url.pathname = '/unauthorized';
          return NextResponse.redirect(url);
        }
      }

      return res;
    }

    // ──────────────────────────────────────────────
    // 3. 일반 사용자 홈 라우트 (/dashboard, /profile, /match-registration 등)
    // ──────────────────────────────────────────────
    if (isProtectedPath && !isAdminRoute && !isManagerRoute && pathname !== '/select-club' && pathname !== '/change-password') {
      const hasClubCookie = Boolean(normalizeClubId(req.cookies.get('active_club_id')?.value));
      if (!hasClubCookie) {
        const url = req.nextUrl.clone();
        url.pathname = '/select-club';
        url.searchParams.set('redirectTo', pathname);
        return NextResponse.redirect(url);
      }
    }
  } catch (error) {
    console.error('Middleware error:', error);
  }

  return res;
}

export const config = {
  matcher: [
    // Match all request paths except for the ones starting with:
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};

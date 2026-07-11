export const AUTH_ROUTE_PREFIXES = ['/login', '/signup', '/superadmin/login'] as const;

export const ADMIN_ROUTE_PREFIXES = [
  '/superadmin',
  '/admin',
  '/admin-setup',
] as const;

export const MANAGER_ROUTE_PREFIXES = [
  '/manager',
  '/match-assignment',
  '/match-results',
  '/match-schedule',
  '/players',
  '/members',
  '/settings',
  '/recurring-matches',
  '/team-management',
] as const;

export const DEFAULT_USER_REDIRECT = '/dashboard';
export const DEFAULT_ADMIN_REDIRECT = '/superadmin';

export function matchesRoutePrefix(
  pathname: string,
  prefixes: readonly string[]
) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isSafeRedirectPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  return pathname.startsWith('/') && !pathname.startsWith('//');
}

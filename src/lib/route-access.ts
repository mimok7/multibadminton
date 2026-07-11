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

// Club management tools are intentionally restricted to club owners/admins.
// Club managers may use match and tournament operations, but must not manage
// members, coins, or products.
export const CLUB_ADMIN_ONLY_ROUTE_PREFIXES = [
  '/members',
  '/manager/coins',
  '/manager/products',
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

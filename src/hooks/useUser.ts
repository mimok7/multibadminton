'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabase';
import { type AppProfile, getRoleFromUser, isAdminOrManagerRole } from '@/lib/auth';
import { fetchProfileServer } from '@/app/actions/profile';

type Profile = AppProfile;

type AuthState = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
};

const INITIAL_AUTH_STATE: AuthState = {
  user: null,
  profile: null,
  loading: true,
};

const AUTH_TIMEOUT_MS = 10000;
const listeners = new Set<() => void>();

let authState = INITIAL_AUTH_STATE;
let authInitialized = false;
let authClient: ReturnType<typeof getSupabaseClient> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;
let cachedProfileUserId: string | null = null;
let pendingProfileRequest: { userId: string; promise: Promise<Profile | null> } | null = null;
let authGeneration = 0;

function emitAuthState(nextState: AuthState) {
  authState = nextState;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return authState;
}

function getServerSnapshot() {
  return INITIAL_AUTH_STATE;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs = AUTH_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('Auth request timed out'));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

async function loadProfile(userId: string, force = false): Promise<Profile | null> {
  if (!force && authState.profile && cachedProfileUserId === userId) {
    return authState.profile;
  }

  const profilePromise =
    !force && pendingProfileRequest?.userId === userId
      ? pendingProfileRequest.promise
      : fetchProfileServer(userId);

  pendingProfileRequest = { userId, promise: profilePromise };

  try {
    return await profilePromise;
  } finally {
    if (pendingProfileRequest?.promise === profilePromise) {
      pendingProfileRequest = null;
    }
  }
}

async function applySession(session: Session | null) {
  const generation = ++authGeneration;
  const user = session?.user ?? null;

  if (!user) {
    cachedProfileUserId = null;
    pendingProfileRequest = null;
    emitAuthState({ user: null, profile: null, loading: false });
    return;
  }

  const cachedProfile =
    cachedProfileUserId === user.id ? authState.profile : null;

  emitAuthState({
    user,
    profile: cachedProfile,
    loading: cachedProfile === null,
  });

  if (cachedProfile) {
    return;
  }

  try {
    const profile = await withTimeout(loadProfile(user.id));
    if (generation !== authGeneration || authState.user?.id !== user.id) {
      return;
    }

    cachedProfileUserId = user.id;
    emitAuthState({ user, profile, loading: false });
  } catch (error) {
    if (generation === authGeneration) {
      console.error('Profile fetch error:', error);
      emitAuthState({ user, profile: null, loading: false });
    }
  }
}

function initializeAuth() {
  const supabase = getSupabaseClient();
  if (authInitialized && authClient === supabase) {
    return;
  }

  authSubscription?.unsubscribe();
  authInitialized = true;
  authClient = supabase;

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => {
      void applySession(session);
    }, 0);
  });
  authSubscription = subscription;

  void withTimeout(supabase.auth.getSession())
    .then(({ data: { session }, error }) => {
      if (error) {
        console.error('Session fetch error:', error);
      }
      return applySession(session);
    })
    .catch((error) => {
      console.error('User fetch error:', error);
      emitAuthState({ user: null, profile: null, loading: false });
    });
}

export function useUser() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    initializeAuth();
  }, []);

  const isAdmin = useMemo(
    () =>
      isAdminOrManagerRole(state.profile?.role) ||
      isAdminOrManagerRole(getRoleFromUser(state.user)),
    [state.profile?.role, state.user]
  );

  const refreshProfile = useCallback(async () => {
    const user = authState.user;
    if (!user) return;

    try {
      const profile = await loadProfile(user.id, true);
      if (authState.user?.id !== user.id) return;

      cachedProfileUserId = user.id;
      emitAuthState({ ...authState, profile });
    } catch (error) {
      console.error('Profile refresh error:', error);
    }
  }, []);

  return {
    user: state.user,
    profile: state.profile,
    loading: state.loading,
    isAdmin,
    refreshProfile,
  };
}

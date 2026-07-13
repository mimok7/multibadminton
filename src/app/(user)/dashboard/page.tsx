'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/useUser';
import ClientDashboard from './ClientDashboard';

export default function DashboardPage() {
  const { user, profile, isAdmin, loading } = useUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
      return;
    }
  }, [loading, user, router]);

  if (loading || !user) return null;

  return <ClientDashboard userId={user.id} email={user.email ?? ''} profile={profile} userIsAdmin={isAdmin} />;
}

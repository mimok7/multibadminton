import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/superadmin';
import SuperadminMembersClient from './SuperadminMembersClient';

export const dynamic = 'force-dynamic';

export default async function SuperadminMembersPage() {
  try {
    const { supabaseAdmin } = await requireSuperadmin();
    const [{ data: clubs, error: clubsError }, { data: memberships, error: membershipsError }, { data: profiles, error: profilesError }] = await Promise.all([
      supabaseAdmin.from('clubs').select('id, name, code').order('name', { ascending: true }),
      supabaseAdmin.from('club_members').select('id, club_id, user_id, role, status, profiles (id, user_id, username, full_name, email, skill_level)').order('role', { ascending: true }),
      supabaseAdmin.from('profiles').select('id, user_id, username, full_name, email, skill_level').order('full_name', { ascending: true }),
    ]);
    if (clubsError) throw clubsError;
    if (membershipsError) throw membershipsError;
    if (profilesError) throw profilesError;
    const rows = (memberships || []).map((row: any) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return { id: row.id, club_id: row.club_id, user_id: row.user_id, role: row.role, status: row.status, username: profile?.username || '', full_name: profile?.full_name || '', email: profile?.email || '', skill_level: profile?.skill_level || '' };
    });
    return <SuperadminMembersClient clubs={clubs || []} memberships={rows} profiles={profiles || []} />;
  } catch (error) {
    if (error instanceof Error && error.message === '로그인이 필요합니다.') redirect('/superadmin/login');
    redirect('/unauthorized');
  }
}

import { redirect } from 'next/navigation';
import { getUserClubs } from '@/lib/club';
import ClubSelectorClient from './ClubSelectorClient';
import { setActiveClubAction as setServerActiveClub } from '@/app/actions/club';
import { getSupabaseServerClient, getSupabaseAdminClient } from '@/lib/supabase-server';
import { getUserRole } from '@/lib/auth';

export default async function SelectClubPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const role = await getUserRole(supabase, user);
  const isGlobalAdmin = role === 'admin';

  let clubs: any[] = [];
  if (isGlobalAdmin) {
    const adminSupabase = getSupabaseAdminClient();
    // 관리자는 가입 여부와 상관없이 모든 클럽 조회 가능
    const { data: allClubs, error } = await adminSupabase
      .from('clubs')
      .select('id, name, code')
      .order('name');
    
    if (!error && allClubs) {
      clubs = allClubs.map((club: any) => ({
        club_id: club.id,
        role: 'admin',
        status: 'active',
        clubs: club,
      }));
    }
  } else {
    clubs = (await getUserClubs()) as any[];
  }

  const resolvedSearchParams = await searchParams;
  const redirectTo = resolvedSearchParams?.redirectTo || '/';



  return (
    <div className="min-h-screen bg-[#0b0f19] flex flex-col items-center justify-center p-6 relative">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />
      
      <div className="w-full max-w-md relative z-10">
        <ClubSelectorClient clubs={clubs as any} isGlobalAdmin={isGlobalAdmin} />
      </div>
    </div>
  );
}

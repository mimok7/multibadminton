import { redirect } from 'next/navigation';
import { getSupabaseServerClient } from '@/lib/supabase-server';
import { getUserRole } from '@/lib/auth';
import { getClubsWithMemberCount } from './actions';
import ClubManagementClient from './ClubManagementClient';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
    const supabase = await getSupabaseServerClient();
    
    // 1. Session verification
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');



    // 3. Fetch clubs data
    const result = await getClubsWithMemberCount();
    if (result.error) {
        return (
            <div className="w-full max-w-4xl mx-auto p-6 text-red-600 bg-red-50 border border-red-200 rounded-lg">
                <h1 className="text-xl font-bold mb-2">데이터 로드 실패</h1>
                <p>{result.error}</p>
            </div>
        );
    }

    return (
        <div className="w-full max-w-7xl mx-auto p-6">
            <ClubManagementClient initialClubs={result.clubs || []} />
        </div>
    );
}

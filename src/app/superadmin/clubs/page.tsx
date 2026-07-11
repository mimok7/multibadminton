import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/superadmin';
import { getClubsWithMemberCount } from '@/app/(admin)/admin/actions';
import ClubManagementClient from '@/app/(admin)/admin/ClubManagementClient';

export const dynamic = 'force-dynamic';

export default async function SuperadminClubsPage() {
  try {
    await requireSuperadmin();
  } catch (error) {
    if (error instanceof Error && error.message === '로그인이 필요합니다.') redirect('/superadmin/login');
    redirect('/unauthorized');
  }

  const result = await getClubsWithMemberCount();
  if (result.error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700">
        <h1 className="text-xl font-bold">클럽 정보를 불러오지 못했습니다.</h1>
        <p className="mt-2 text-sm">{result.error}</p>
      </div>
    );
  }

  return <ClubManagementClient initialClubs={result.clubs || []} />;
}

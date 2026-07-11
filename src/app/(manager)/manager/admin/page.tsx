import { redirect } from 'next/navigation';
import { requireSuperadmin } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
    try {
        await requireSuperadmin();
    } catch (error) {
        if (error instanceof Error && error.message === '로그인이 필요합니다.') {
            redirect('/login');
        }
        redirect('/unauthorized');
    }

    redirect('/admin');
}

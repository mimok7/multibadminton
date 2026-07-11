import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireSuperadmin } from '@/lib/superadmin';

export const dynamic = 'force-dynamic';

export default async function SuperadminPage() {
  try {
    await requireSuperadmin();
  } catch (error) {
    if (error instanceof Error && error.message === '로그인이 필요합니다.') redirect('/login');
    redirect('/unauthorized');
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="rounded-3xl bg-gradient-to-br from-slate-950 via-indigo-950 to-indigo-800 p-6 text-white shadow-xl sm:p-10">
        <div className="text-sm font-bold uppercase tracking-[0.2em] text-indigo-200">System Control Center</div>
        <h1 className="mt-3 text-3xl font-black sm:text-4xl">슈퍼관리자 페이지</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-indigo-100 sm:text-base">클럽과 전체 회원 등 서비스 전체에 영향을 주는 시스템 기능만 관리합니다.</p>
      </div>

      <section className="mt-8">
        <h2 className="text-xl font-bold text-slate-900">시스템 관리</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <Link href="/superadmin/clubs" className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg">
            <div className="text-3xl">🏢</div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">클럽 관리</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">전체 클럽 생성, 수정, 삭제와 클럽별 매니저 설정을 관리합니다.</p>
            <div className="mt-5 text-sm font-bold text-indigo-600">클럽 관리 열기 →</div>
          </Link>
          <Link href="/admin/members" className="group rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg">
            <div className="text-3xl">👥</div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">전체 사용자 관리</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">전체 회원의 프로필, 역할, 등급과 계정 운영을 관리합니다.</p>
            <div className="mt-5 text-sm font-bold text-indigo-600">사용자 관리 열기 →</div>
          </Link>
        </div>
      </section>
    </div>
  );
}

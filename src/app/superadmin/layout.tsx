import SuperadminShell from '@/components/admin/SuperadminShell';

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return <SuperadminShell>{children}</SuperadminShell>;
}

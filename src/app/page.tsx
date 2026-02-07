import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppLayout } from '@/components/layout';
import OverviewPage from './(dashboard)/overview/page';

export default async function Home() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/signin');
  }

  return (
    <AppLayout>
      <OverviewPage />
    </AppLayout>
  );
}

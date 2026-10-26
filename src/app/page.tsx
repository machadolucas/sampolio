import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppLayout } from '@/components/layout';
import { HomeDashboard } from '@/components/home/home-dashboard';
import { Suspense } from 'react';

async function AuthenticatedHome() {
  const session = await auth();

  if (!session?.user) {
    redirect('/auth/signin');
  }

  return (
    <AppLayout>
      <HomeDashboard />
    </AppLayout>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div role="status" className="p-6 text-muted-foreground">Loading Sampolio…</div>}>
      <AuthenticatedHome />
    </Suspense>
  );
}

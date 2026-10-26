import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppLayout } from '@/components/layout';
import { Suspense } from 'react';

// Server-side auth gate for every (dashboard) page. The proxy (src/proxy.ts) only
// checks cookie presence; this validates the actual session so page shells
// never render unauthenticated. Data stays guarded per-action regardless.
async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();

    if (!session?.user) {
        redirect('/auth/signin');
    }

    return <AppLayout>{children}</AppLayout>;
}

export default function Layout({ children }: { children: React.ReactNode }) {
    // Request-time session validation must remain outside cached output. The
    // public fallback contains no account data or authenticated navigation.
    return (
        <Suspense fallback={<div role="status" className="p-6 text-muted-foreground">Loading Sampolio…</div>}>
            <AuthenticatedLayout>{children}</AuthenticatedLayout>
        </Suspense>
    );
}

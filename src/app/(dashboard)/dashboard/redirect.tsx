'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Redirect old /dashboard to new /overview (which is now the root)
export default function DashboardPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/');
    }, [router]);

    return null;
}

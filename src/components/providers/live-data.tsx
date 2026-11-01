'use client';

import { useSession } from '@/lib/auth-client';
import { useLiveData } from '@/lib/hooks/use-live-data';

export function LiveData() {
  const { data: session } = useSession();
  useLiveData(session?.user?.id);
  return null;
}

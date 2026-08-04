'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProviderPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/driver');
  }, [router]);
  return <p className="state">Opening Driver dashboard…</p>;
}

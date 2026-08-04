'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RidePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/customer');
  }, [router]);
  return <p className="state">Opening Ride…</p>;
}

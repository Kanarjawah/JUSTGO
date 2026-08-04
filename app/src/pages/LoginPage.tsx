'use client';

import SignInForm from '../components/SignInForm';
import { useAuth } from '../context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function LoginPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    const dest =
      user.role === 'ADMIN'
        ? '/admin'
        : user.role === 'DRIVER'
          ? '/driver'
          : user.role === 'MERCHANT'
            ? '/merchant'
            : '/customer';
    router.replace(dest);
  }, [user, router]);

  return (
    <SignInForm
      title="Sign in to JUSTGO"
      subtitle="Use your role account. Demo phones use +231770000001–004 with Password123!"
    />
  );
}

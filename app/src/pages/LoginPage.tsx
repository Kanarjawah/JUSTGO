import SignInForm from '../components/SignInForm';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';

export default function LoginPage() {
  const { user } = useAuth();
  if (user) {
    const dest =
      user.role === 'ADMIN'
        ? '/admin'
        : user.role === 'DRIVER'
          ? '/driver'
          : user.role === 'MERCHANT'
            ? '/merchant'
            : '/customer';
    return <Navigate to={dest} replace />;
  }
  return (
    <SignInForm
      title="Sign in to JUSTGO"
      subtitle="Use your role account. Demo phones use +231770000001–004 with Password123!"
    />
  );
}

import { Navigate } from 'react-router-dom';

/** Legacy Provider route now opens the Driver dashboard (Availability + Current Requests). */
export default function ProviderPage() {
  return <Navigate to="/driver" replace />;
}

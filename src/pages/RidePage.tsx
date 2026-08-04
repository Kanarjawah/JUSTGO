import { Navigate } from 'react-router-dom';

/** Ride is part of Customer Services — route preserved for bottom-nav quick access. */
export default function RidePage() {
  return <Navigate to="/customer" replace />;
}

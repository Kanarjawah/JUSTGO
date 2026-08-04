import type { ReactNode } from 'react';
import { AuthProvider } from './src/context/AuthContext';
import AppShell from './src/components/AppShell';
import './src/styles/theme.css';

export const metadata = {
  title: 'JUSTGO Liberia',
  description: 'Ride, deliver, and trade across Liberia',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}

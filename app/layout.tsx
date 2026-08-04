import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { AuthProvider } from './src/context/AuthContext';
import AppShell from './src/components/AppShell';
import { getAppOriginUrl } from './server/lib/app-url';
import './src/styles/theme.css';

export const metadata: Metadata = {
  metadataBase: getAppOriginUrl(),
  title: 'JUSTGO Liberia',
  description: 'Ride, deliver, and trade across Liberia',
  alternates: {
    canonical: '/',
  },
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

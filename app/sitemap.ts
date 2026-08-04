import type { MetadataRoute } from 'next';
import { getAppUrl } from '@/server/lib/app-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getAppUrl();
  const lastModified = new Date();

  return [
    '',
    '/login',
    '/customer',
    '/customer/services',
    '/customer/ride',
    '/delivery',
    '/market',
    '/provider',
    '/terms',
    '/privacy',
  ].map((path) => ({
    url: `${base}${path || '/'}`,
    lastModified,
  }));
}

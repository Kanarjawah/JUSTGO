import type { MetadataRoute } from 'next';
import { getAppUrl } from '@/server/lib/app-url';

export default function robots(): MetadataRoute.Robots {
  const base = getAppUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin'],
    },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}

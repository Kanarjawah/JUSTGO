'use client';

import Image from 'next/image';
import { useState } from 'react';

/** Full-resolution JUSTGO wordmark/logo — always object-contain, never cropped. */
export const JUSTGO_LOGO_SRC = '/images/justgo-logo.png';

type BrandLogoProps = {
  variant?: 'hero' | 'header';
  className?: string;
};

export default function BrandLogo({ variant = 'hero', className }: BrandLogoProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  if (variant === 'header') {
    return (
      <span className={`brand-logo-header ${className ?? ''}`.trim()}>
        <Image
          src={JUSTGO_LOGO_SRC}
          alt="JUSTGO Liberia Logo"
          fill
          sizes="140px"
          className="object-contain"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <div className={`home-logo-frame ${className ?? ''}`.trim()}>
      <div className="home-logo-inner">
        <Image
          src={JUSTGO_LOGO_SRC}
          alt="JUSTGO Liberia Logo"
          fill
          priority
          sizes="(max-width: 640px) 90vw, (max-width: 1024px) 60vw, 560px"
          className="object-contain"
          onError={() => setFailed(true)}
        />
      </div>
    </div>
  );
}

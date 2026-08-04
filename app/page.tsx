import Link from 'next/link';
import BrandLogo from './src/components/BrandLogo';

export default function HomePage() {
  return (
    <section className="home-hero" aria-labelledby="justgo-home-title">
      <BrandLogo variant="hero" />
      <h1 id="justgo-home-title" className="home-hero-title">
        JUSTGO<span>.</span>
      </h1>
      <p className="home-hero-tagline">
        Liberia · Ride · Deliver · Trade — premium mobility and marketplace services across the nation.
      </p>
      <div className="home-hero-actions">
        <Link className="primary-btn" href="/customer">
          Book a service
        </Link>
        <Link className="ghost-btn" href="/login">
          Sign in
        </Link>
      </div>
    </section>
  );
}

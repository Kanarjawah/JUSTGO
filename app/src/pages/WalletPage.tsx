'use client';

export default function WalletPage() {
  return (
    <section>
      <h1>Your Wallet</h1>
      <p className="page-sub">Top up with mobile money. Cash is not supported.</p>
      <div className="wallet-card">
        <small>JUSTGO WALLET</small>
        <strong>L$ 8,400</strong>
        <span>Demo balance · live payouts not configured</span>
      </div>
      <div className="button-row">
        <button type="button" className="ghost-btn">
          Orange Money
        </button>
        <button type="button" className="ghost-btn">
          MTN MoMo
        </button>
      </div>
      <p className="muted">
        MTN MoMo and Orange Money are listed as supported methods. Production payment credentials are
        not embedded in this app and live settlement is not claimed here.
      </p>
      <h2>Recent activity</h2>
      {['Sold Ankara Fabric +L$2,400', 'Ride to Red-Light -L$350', 'Top-up +L$5,000'].map((x) => (
        <div className="transaction" key={x}>
          {x}
        </div>
      ))}
    </section>
  );
}

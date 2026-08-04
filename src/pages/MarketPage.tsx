export default function MarketPage(){
 const items=[['🥬','Fresh Cassava Leaf','L$120'],['📱','Used iPhone 8','L$4,200'],['🧵','Ankara Fabric','L$1,800'],['🍚','Bag of Rice','L$2,600']];
 return <section><h1>JUSTGO Market</h1><p className="page-sub">Buy and sell with people near you.</p><div className="market-grid">{items.map(([icon,name,price])=><article className="market-card" key={name}><div>{icon}</div><strong>{name}</strong><span>{price}</span><small>Verified local seller</small></article>)}</div><button className="secondary-btn">+ List something to sell</button></section>
}

export type ServiceCardProps = {
  title: string;
  subtitle: string;
  meta: string;
  amount: string;
  eta: string;
  icon: string;
  selected?: boolean;
  onClick?: () => void;
};

export default function ServiceCard(props: ServiceCardProps) {
  return (
    <button className={`service-card ${props.selected ? 'selected' : ''}`} onClick={props.onClick}>
      <div className="service-icon">{props.icon}</div>
      <div className="service-copy">
        <strong>{props.title}</strong>
        <em>“{props.subtitle}”</em>
        <small>{props.meta}</small>
      </div>
      <div className="service-price">
        <strong>{props.amount}</strong>
        <span>{props.eta}</span>
      </div>
    </button>
  );
}

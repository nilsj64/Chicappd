export function BrandMark({ className }: { className?: string }) {
  return <img className={`brand-logo-mark ${className ?? ""}`}
    src={`${import.meta.env.BASE_URL}Chicappd-brand-assets/Chicappd-card-backs/C-dot-mark.svg`}
    alt="" aria-hidden="true" />;
}

export default function Brand({ light = false }: { light?: boolean }) {
  return <div className={`brand ${light ? "brand-light" : ""}`}>
    <span className="brand-mark"><BrandMark /></span>
    <span>chicappd<span className="brand-dot">.</span></span>
  </div>;
}

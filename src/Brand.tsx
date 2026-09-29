export function BrandMark({ className }: { className?: string }) {
  return <svg className={`brand-logo-mark ${className ?? ""}`} viewBox="0 0 80 80"
    aria-hidden="true" focusable="false">
    <rect className="brand-logo-tile" width="80" height="80" rx="13" />
    <text className="brand-logo-letter" x="8" y="64" fontFamily="Fraunces, serif"
      fontSize="69" fontWeight="600" letterSpacing="-4">C</text>
    <circle className="brand-logo-dot" cx="62" cy="59" r="6" />
  </svg>;
}

export default function Brand({ light = false }: { light?: boolean }) {
  return <div className={`brand ${light ? "brand-light" : ""}`}>
    <span className="brand-mark"><BrandMark /></span>
    <span>chicappd<span className="brand-dot">.</span></span>
  </div>;
}

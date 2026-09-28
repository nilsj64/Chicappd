export function StarMark({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <path d="M50 9v82M9 50h82M21 21l58 58M79 21 21 79" />
  </svg>;
}

export default function Brand({ light = false }: { light?: boolean }) {
  return <div className={`brand ${light ? "brand-light" : ""}`}>
    <span className="brand-mark"><StarMark /></span>
    <span>chicappd<span className="brand-dot">.</span></span>
  </div>;
}

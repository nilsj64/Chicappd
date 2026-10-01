import { useEffect, useRef, useState } from "react";
import type { ExchangeEvent } from "./game";

/** Decorative dealer; exchange playback is shared with the table's card animation. */
export default function MonkeyDealer({ exchange, initialDeal, presentedExchange }: {
  exchange?: ExchangeEvent;
  initialDeal: boolean;
  presentedExchange?: string;
}) {
  const [delivery, setDelivery] = useState(initialDeal ? "round" : "");
  const lastPresented = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Accepting an already presented card does not deal another card. Bots may
    // present and accept in one update, so their completed event still animates.
    if (exchange?.changedCards && !(exchange.singleCardChoice === "accepted" &&
      lastPresented.current === `${exchange.playerId}:${exchange.exchangeCount}`)) {
      setDelivery(`exchange:${exchange.id}`);
    }
  }, [exchange?.id, exchange?.changedCards]);
  useEffect(() => {
    if (!presentedExchange) return;
    lastPresented.current = presentedExchange;
    setDelivery(`presented:${presentedExchange}`);
  }, [presentedExchange]);

  return <div className="monkey-dealer" aria-hidden="true">
    <svg viewBox="0 0 100 108" fill="none" focusable="false">
      <ellipse cx="50" cy="101" rx="34" ry="5" fill="#183e34" opacity=".3" />
      <g className="dealer-idle">
        <path d="M72 86c27 8 23-26 12-20" stroke="#ac7358" strokeWidth="7" strokeLinecap="round" />
        <path d="M26 96V79c0-17 48-17 48 0v17" fill="#f0ead8" stroke="#183e34" strokeWidth="2" />
        <path d="m31 70 19 12 19-12v27H31Z" fill="#183e34" />
        <path d="m50 77-8-4v10l8-4 8 4V73Z" fill="#e18d70" />
        <circle cx="22" cy="39" r="13" fill="#ac7358" stroke="#183e34" strokeWidth="2" />
        <circle cx="78" cy="39" r="13" fill="#ac7358" stroke="#183e34" strokeWidth="2" />
        <circle cx="22" cy="39" r="7" fill="#e18d70" />
        <circle cx="78" cy="39" r="7" fill="#e18d70" />
        <path d="M21 40c0-22 13-30 29-30s29 8 29 30v12c0 17-13 25-29 25S21 69 21 52Z" fill="#ac7358" stroke="#183e34" strokeWidth="2" />
        <path d="M30 41c0-15 14-16 20-7 6-9 20-8 20 7v14c0 11-9 17-20 17s-20-6-20-17Z" fill="#f0ead8" />
        <path d="M46 13c-4-6 2-10 7-7" stroke="#ac7358" strokeWidth="4" strokeLinecap="round" />
        <g className="dealer-eyes">
          <ellipse cx="39" cy="44" rx="2.5" ry="3.5" fill="#183e34" />
          <ellipse cx="61" cy="44" rx="2.5" ry="3.5" fill="#183e34" />
        </g>
        <ellipse cx="50" cy="54" rx="4" ry="2.5" fill="#183e34" />
        <path d="M42 61q8 7 16 0" stroke="#183e34" strokeWidth="2" strokeLinecap="round" />
        <path d="m28 79-7 12 14 4" stroke="#ac7358" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
        <g key={delivery} className={`dealer-arm ${delivery ? "dealer-arm-deal" : ""}`}>
          <path d="m71 79 6 12-14 4" stroke="#ac7358" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="53" y="83" width="14" height="20" rx="2" transform="rotate(-12 60 93)" fill="#f0ead8" stroke="#183e34" strokeWidth="1.5" />
          <path d="m60 88-3 5 3 5 3-5Z" fill="#e18d70" />
        </g>
      </g>
    </svg>
  </div>;
}

import { useEffect, useRef, useState } from "react";
import type { ExchangeEvent } from "./game";
import { CHIBI_FRAMES, DEALER_ANIMATIONS, DEALER_DEAL_MS, DEALER_FRAME_MS, exchangeNeedsDeal } from "./dealerAnimation";
import type { DealerAnimation } from "./dealerAnimation";

/** Decorative playback only; never changes authoritative game state. */
export default function ChibiDealer({ exchange, initialDeal, presentedExchange }: {
  exchange?: ExchangeEvent;
  initialDeal: boolean;
  presentedExchange?: string;
}) {
  const [playback, setPlayback] = useState<{ animation: DealerAnimation; id: string }>({
    animation: initialDeal ? "deal" : "idle", id: "round",
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const lastPresented = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (exchangeNeedsDeal(exchange, lastPresented.current)) {
      setFrameIndex(0);
      setPlayback({ animation: "deal", id: `exchange:${exchange!.id}` });
    }
  }, [exchange?.id]);
  useEffect(() => {
    if (!presentedExchange) return;
    lastPresented.current = presentedExchange;
    setFrameIndex(0);
    setPlayback({ animation: "offer", id: presentedExchange });
  }, [presentedExchange]);
  useEffect(() => {
    // A held offer returns to neutral as soon as the choice is resolved.
    if (!presentedExchange && playback.animation === "offer") {
      setFrameIndex(0);
      setPlayback({ animation: "idle", id: "waiting" });
    }
  }, [presentedExchange, playback.animation]);
  useEffect(() => {
    const frames = DEALER_ANIMATIONS[playback.animation];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion && playback.animation === "idle") return;
    if (reducedMotion && playback.animation === "offer") {
      setFrameIndex(frames.length - 1);
      return;
    }
    const timer = window.setTimeout(() => {
      if (reducedMotion && playback.animation === "deal") {
        setFrameIndex(0);
        setPlayback({ animation: "idle", id: "waiting" });
      }
      else if (frameIndex + 1 < frames.length) setFrameIndex(frameIndex + 1);
      else if (playback.animation === "idle") setFrameIndex(0);
      else if (playback.animation === "deal") {
        setFrameIndex(0);
        setPlayback({ animation: "idle", id: "waiting" });
      }
      // Hold the visible card while waiting for the exchange decision.
    }, reducedMotion ? DEALER_DEAL_MS :
      playback.animation === "idle" ? (frameIndex === 3 ? 120 : 1400) : DEALER_FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [playback, frameIndex]);
  const sequence = DEALER_ANIMATIONS[playback.animation];
  const frame = sequence[Math.min(frameIndex, sequence.length - 1)];
  const [x, y, width, height] = CHIBI_FRAMES[frame];
  return <div className="chibi-dealer" aria-hidden="true" data-animation={playback.animation}
    data-playback={playback.id} data-frame={frame}>
    <svg viewBox="0 0 160 158" fill="none" focusable="false">
      <svg x={(160 - width) / 2} y={158 - height} width={width} height={height}
        viewBox={`${x} ${y} ${width} ${height}`} overflow="hidden">
        <image href={`${import.meta.env.BASE_URL}characters/chibi-dealer.png`} width="1122" height="1402" />
      </svg>
    </svg>
  </div>;
}

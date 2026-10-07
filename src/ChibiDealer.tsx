import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHIBI_FRAMES, CHIBI_BODY_X, DEALER_ANIMATIONS, DEALER_DEAL_MS, DEALER_FRAME_MS, DEALER_RELEASE_FRAME, DEALER_HAND, dealerMirrored } from "./dealerAnimation";
import type { DealerAnimation, DealerDirection } from "./dealerAnimation";

/** Decorative playback only; never changes authoritative game state. */
export default function ChibiDealer({ dealCue, initialDeal, presentedExchange, onRelease, onDealComplete, targetSelector = ".your-hand" }: {
  dealCue?: string;
  initialDeal: boolean;
  presentedExchange?: string;
  onRelease?: (cue: string) => void;
  onDealComplete?: (cue: string) => void;
  targetSelector?: string;
}) {
  const [playback, setPlayback] = useState<{ animation: DealerAnimation; id: string }>({
    animation: initialDeal ? "deal" : "idle", id: "round",
  });
  const [frameIndex, setFrameIndex] = useState(0);
  const dealerRef = useRef<HTMLDivElement>(null);
  const [direction, setDirection] = useState<DealerDirection>("left");
  useLayoutEffect(() => {
    const dealer = dealerRef.current;
    const target = document.querySelector(targetSelector);
    if (!dealer || !target) return;
    const orient = () => {
      const from = dealer.getBoundingClientRect(), to = target.getBoundingClientRect();
      setDirection(to.x + to.width / 2 < from.x + from.width / 2 ? "left" : "right");
    };
    orient();
    const observer = new ResizeObserver(orient);
    observer.observe(dealer);
    observer.observe(target);
    window.addEventListener("resize", orient);
    return () => { observer.disconnect(); window.removeEventListener("resize", orient); };
  }, [targetSelector]);
  const releasedCue = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    // A flight starts only after this release frame exists in the rendered SVG.
    if (playback.animation === "deal" && frameIndex === DEALER_RELEASE_FRAME && releasedCue.current !== playback.id) {
      releasedCue.current = playback.id;
      onRelease?.(playback.id);
    }
  }, [playback, frameIndex, onRelease]);
  useEffect(() => {
    if (dealCue) {
      setFrameIndex(0);
      setPlayback({ animation: "deal", id: dealCue });
    }
  }, [dealCue]);
  useEffect(() => {
    if (!presentedExchange) return;
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
    if (playback.animation !== "idle" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setFrameIndex(index => (index + 1) % DEALER_ANIMATIONS.idle.length),
      frameIndex === 3 ? 120 : 1400);
    return () => window.clearTimeout(timer);
  }, [playback, frameIndex]);
  useEffect(() => {
    if (playback.animation === "idle") return;
    const frames = DEALER_ANIMATIONS[playback.animation];
    const finish = () => {
      setFrameIndex(0);
      setPlayback({ animation: "idle", id: "waiting" });
      onDealComplete?.(playback.id);
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (playback.animation === "offer") { setFrameIndex(frames.length - 1); return; }
      const timer = window.setTimeout(finish, DEALER_DEAL_MS);
      return () => window.clearTimeout(timer);
    }
    // Use a single clock, rather than accumulating one timer/render delay per
    // pose. Never skip the release frame, even after a suspended browser tab.
    let started = performance.now(), previousIndex = 0, request = 0;
    const tick = (now: number) => {
      let index = Math.max(0, Math.floor((now - started) / DEALER_FRAME_MS));
      if (playback.animation === "deal" && previousIndex < DEALER_RELEASE_FRAME && index > DEALER_RELEASE_FRAME) {
        index = DEALER_RELEASE_FRAME;
        started = now - index * DEALER_FRAME_MS;
      }
      if (index >= frames.length && playback.animation === "deal") { finish(); return; }
      index = Math.min(index, frames.length - 1);
      if (index !== previousIndex) { previousIndex = index; setFrameIndex(index); }
      if (playback.animation === "offer" && index === frames.length - 1) return;
      request = window.requestAnimationFrame(tick);
    };
    request = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(request);
  }, [playback, onDealComplete]);
  const sequence = DEALER_ANIMATIONS[playback.animation];
  const frame = sequence[Math.min(frameIndex, sequence.length - 1)];
  const [x, y, width, height] = CHIBI_FRAMES[frame];
  const mirrored = dealerMirrored(playback.animation, direction);
  return <div ref={dealerRef} className="chibi-dealer" aria-hidden="true" data-animation={playback.animation}
    data-playback={playback.id} data-frame={frame} data-direction={direction} data-mirrored={mirrored}>
    <svg viewBox="0 0 160 158" fill="none" focusable="false">
      <g transform={mirrored ? "translate(160 0) scale(-1 1)" : undefined}>
      <svg x={80 - CHIBI_BODY_X[frame]} y={158 - height} width={width} height={height}
        viewBox={`${x} ${y} ${width} ${height}`} overflow="hidden">
        <image href={`${import.meta.env.BASE_URL}characters/chibi-dealer.png`} width="1122" height="1402" />
      </svg>
      <circle className="dealer-release-origin" cx={DEALER_HAND.x} cy={DEALER_HAND.y} r="1" opacity="0" />
      </g>
    </svg>
  </div>;
}

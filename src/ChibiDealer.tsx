import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHIBI_FRAMES, CHIBI_SHEET, DEALER_ANIMATIONS, DEALER_DEAL_MS, DEALER_FRAME_MS, DEALER_RELEASE_FRAME, DEALER_HAND, DEALER_IDLE_FRAME_MS } from "./dealerAnimation";
import type { DealerAnimation } from "./dealerAnimation";

/** Decorative playback only; never changes authoritative game state. */
export default function ChibiDealer({ dealCue, initialDeal, presentedExchange, onRelease, onDealComplete }: {
  dealCue?: string;
  initialDeal: boolean;
  presentedExchange?: string;
  onRelease?: (cue: string) => void;
  onDealComplete?: (cue: string) => void;
}) {
  const [playback, setPlayback] = useState<{ animation: DealerAnimation; id: string }>({
    animation: initialDeal ? "deal" : "idle", id: "round",
  });
  const [frameIndex, setFrameIndex] = useState(0);
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
      DEALER_IDLE_FRAME_MS[frameIndex]);
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
  return <div className="chibi-dealer" aria-hidden="true" data-animation={playback.animation}
    data-playback={playback.id} data-frame={frame} data-direction="left">
    <svg viewBox="0 0 160 158" fill="none" focusable="false">
      <svg x={(160 - width * 158 / height) / 2} width={width * 158 / height} height="158"
        viewBox={`${x} ${y} ${width} ${height}`}
        preserveAspectRatio="xMidYMax meet" overflow="hidden">
        <image href={`${import.meta.env.BASE_URL}characters/chibi-dealer-optimized.png`} width={CHIBI_SHEET.width} height={CHIBI_SHEET.height} />
      </svg>
      <circle className="dealer-release-origin" cx={DEALER_HAND.x} cy={DEALER_HAND.y} r="1" opacity="0" />
    </svg>
  </div>;
}

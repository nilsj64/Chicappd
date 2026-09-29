import type { ReactNode } from "react";
import type { Suit } from "./game";

type IconName = "arrow-right" | "arrow-left" | "arrow-up-right" |
  "star" | "copy" | "check" | "undo" | "plus" | "minus" | "heart";

export function Icon({ name, className }: { name: IconName; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    "arrow-right": <path d="M4 12h16m-6-6 6 6-6 6" />,
    "arrow-left": <path d="M20 12H4m6-6-6 6 6 6" />,
    "arrow-up-right": <path d="M5 19 19 5M8 5h11v11" />,
    star: <path d="m12 2 3.1 6.5 7.2 1-5.2 5.1 1.2 7.2-6.3-3.4-6.3 3.4 1.2-7.2-5.2-5.1 7.2-1L12 2Z" />,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    undo: <><path d="M9 7 4 12l5 5M4 12h10a6 6 0 1 1 0 12" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    minus: <path d="M4 12h16" />,
    heart: <path d="M20.8 4.6a5.6 5.6 0 0 0-7.9 0L12 5.5l-.9-.9a5.6 5.6 0 0 0-7.9 0 5.6 5.6 0 0 0 0 7.9L12 21l8.8-8.5a5.6 5.6 0 0 0 0-7.9Z" />,
  };
  return <svg className={`ui-icon ${className ?? ""}`} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

const suitPaths: Record<Suit, ReactNode> = {
  hearts: <path d="M12 21s-9-5.7-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6.3-9 12-9 12Z" />,
  diamonds: <path d="M12 2 21 12 12 22 3 12 12 2Z" />,
  spades: <><path d="M12 2C9 6 3 10 3 14a5 5 0 0 0 9 3 5 5 0 0 0 9-3c0-4-6-8-9-12Z" /><path d="M9 22c2-2 3-4 3-6 0 2 1 4 3 6H9Z" /></>,
  clubs: <path d="M12 2.3c-2.6 0-4.3 1.8-4.3 4.1 0 1 .4 2 1.1 2.8-.9-.6-1.9-.9-3-.9-2.4 0-4 1.9-4 4.3 0 2.5 1.7 4.3 4 4.3 2.1 0 3.5-1.2 4.5-2.5.1 2-.2 4.3-1.4 6.8 1.8.5 3.9.5 5.7 0-1.2-2.5-1.5-4.8-1.4-6.8 1 1.3 2.4 2.5 4.5 2.5 2.3 0 4-1.8 4-4.3 0-2.4-1.6-4.3-4-4.3-1.1 0-2.1.3-3 .9.7-.8 1.1-1.8 1.1-2.8 0-2.3-1.7-4.1-4.3-4.1Z" />,
};

export function SuitIcon({ suit, className }: { suit: Suit; className?: string }) {
  return <svg className={`suit-icon ${className ?? ""}`} viewBox="0 0 24 24" fill="currentColor"
    aria-hidden="true" focusable="false">{suitPaths[suit]}</svg>;
}

/** Small, friendly line icons (inline SVG, no external assets). Decorative: always aria-hidden. */
import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const IconLock = () => (
  <Svg>
    <rect x="5" y="10.5" width="14" height="10" rx="3" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
);
export const IconFeather = () => (
  <Svg>
    <path d="M20 4c-6 0-12 4.5-12 11v5" />
    <path d="M8 15c4 0 8-2 10-6" />
    <path d="M8 20h4" />
  </Svg>
);
export const IconHeart = () => (
  <Svg>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </Svg>
);
export const IconHand = () => (
  <Svg>
    <path d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M10 10.5V5a1.5 1.5 0 0 1 3 0v5.5" />
    <path d="M13 10.5V6a1.5 1.5 0 0 1 3 0v6" />
    <path d="M16 11.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 5 14.5L4 12a1.5 1.5 0 0 1 2.6-1.4L7 12" />
  </Svg>
);
export const IconBook = () => (
  <Svg>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z" />
  </Svg>
);
export const IconFile = () => (
  <Svg>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
);
export const IconImage = () => (
  <Svg>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 16l-5-5-8 8.5" />
  </Svg>
);
export const IconPeople = () => (
  <Svg>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9.5" r="2.4" />
    <path d="M16 14.2a4.5 4.5 0 0 1 4.5 4.8" />
  </Svg>
);
export const IconLeaf = () => (
  <Svg>
    <path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" />
    <path d="M5 19l7-7" />
  </Svg>
);
export const IconShield = () => (
  <Svg>
    <path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

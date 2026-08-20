/**
 * State Emblem of India — the masthead mark on the sign-in page.
 *
 * ⚠ PLACEHOLDER GEOMETRY. This is a hand-authored monochrome rendition, drawn to
 * the right proportions and weight so the layout is correct, but it is NOT the
 * official artwork. The State Emblem is a statutory symbol (State Emblem of India
 * (Prohibition of Improper Use) Act, 2005) and should be reproduced from the
 * authorised asset, not approximated.
 *
 * TO DROP IN THE REAL ONE: put the official file at
 * `packages/web/public/emblem.svg` and replace the <svg> below with
 *   <img src="/emblem.svg" alt="State Emblem of India" className={className} />
 * Nothing else on the page needs to change — the box is 42×56 and the parent
 * controls placement. Keep it same-origin: the server CSP allows `img-src 'self'`
 * but no external image hosts.
 */

export function Emblem({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 42 56"
      className={className}
      role="img"
      aria-label="State Emblem of India"
      fill="currentColor"
    >
      {/* Three of the four lions of the Sarnath capital, facing out */}
      <path d="M21 3c-2.6 0-4.3 1.8-4.6 4-1.1.5-1.8 1.5-1.8 2.8 0 .7.2 1.3.6 1.8-.5.6-.8 1.4-.8 2.2v1.4h13.2v-1.4c0-.8-.3-1.6-.8-2.2.4-.5.6-1.1.6-1.8 0-1.3-.7-2.3-1.8-2.8-.3-2.2-2-4-4.6-4z" />
      <path d="M12.4 8.2c-1.9.4-3.2 1.9-3.2 3.8 0 .6.1 1.1.4 1.6-.5.6-.8 1.3-.8 2.1v1.5h5.1v-1.9c0-1-.3-1.9-.9-2.6.3-.5.4-1 .4-1.6 0-1.1-.4-2.1-1-2.9z" />
      <path d="M29.6 8.2c-.6.8-1 1.8-1 2.9 0 .6.1 1.1.4 1.6-.6.7-.9 1.6-.9 2.6v1.9h5.1v-1.5c0-.8-.3-1.5-.8-2.1.3-.5.4-1 .4-1.6 0-1.9-1.3-3.4-3.2-3.8z" />

      {/* Abacus — the band the lions stand on */}
      <rect x="7.6" y="17.4" width="26.8" height="2.1" rx=".5" />

      {/* Abacus frieze: chakra centred, flanked by the bull and the horse */}
      <circle cx="21" cy="24.6" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="21" cy="24.6" r=".85" />
      {/* 12 of the chakra's spokes, drawn as a rotated set */}
      {Array.from({ length: 12 }, (_, i) => (
        <rect
          key={i}
          x="20.75"
          y="21"
          width=".5"
          height="3"
          transform={`rotate(${i * 30} 21 24.6)`}
        />
      ))}
      <path d="M10.4 26.6c.4-1.6 1.6-2.8 3.2-3l.5-1.2.5 1.2c1.6.2 2.8 1.4 3.2 3z" />
      <path d="M24.2 26.6c.4-1.6 1.6-2.8 3.2-3l.5-1.2.5 1.2c1.6.2 2.8 1.4 3.2 3z" />

      {/* Bell-shaped lotus base */}
      <path d="M11.4 29.6h19.2c-.6 2.3-1.9 4.1-3.6 5.1H15c-1.7-1-3-2.8-3.6-5.1z" />
      <rect x="13.8" y="35.5" width="14.4" height="1.6" rx=".5" />

      {/* सत्यमेव जयते — set as text so it renders with the page font stack */}
      <text
        x="21"
        y="45.4"
        textAnchor="middle"
        fontSize="7.2"
        fontWeight="600"
        fill="currentColor"
        style={{ fontFamily: 'inherit' }}
      >
        सत्यमेव
      </text>
      <text
        x="21"
        y="53.6"
        textAnchor="middle"
        fontSize="7.2"
        fontWeight="600"
        fill="currentColor"
        style={{ fontFamily: 'inherit' }}
      >
        जयते
      </text>
    </svg>
  );
}

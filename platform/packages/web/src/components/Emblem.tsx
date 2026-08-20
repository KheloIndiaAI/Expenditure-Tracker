/**
 * State Emblem of India — the masthead mark on the sign-in page.
 *
 * The artwork is the official emblem, supplied by the ministry and committed at
 * `src/assets/emblem.png`. It is imported rather than referenced by path so Vite
 * fingerprints it into `dist/assets/` — that matters, because the server only
 * mounts `/assets/` as static (`main.ts`); anything else is caught by the
 * not-found handler and redirected to /login, so a file dropped in `public/`
 * would silently 404. Same-origin also keeps it inside `img-src 'self'`.
 *
 * Stored as greyscale+alpha at the original 371×537. The source was pure
 * greyscale in RGB on every pixel, so that conversion is lossless — the stored
 * file is pixel-identical to what was supplied, at 44% of the bytes. Do not
 * re-encode it to a lossy format or resample it: it is a statutory symbol under
 * the State Emblem of India (Prohibition of Improper Use) Act, 2005.
 *
 * Height is the controlling dimension; width follows the intrinsic 0.691 ratio
 * so the emblem is never stretched.
 */

import emblemUrl from '../assets/emblem.png';

export function Emblem({ className }: { className?: string }) {
  return <img src={emblemUrl} alt="State Emblem of India" className={className} />;
}

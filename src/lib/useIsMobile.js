// src/lib/useIsMobile.js — one definition of "narrow" for the whole app,
// matching the 768px breakpoint used in src/styles/global.css.
//
// Used only where a layout decision cannot be expressed in CSS (swapping
// the sidebar for a bottom bar, turning a modal into a sheet). Anything
// that CAN be done in a media query is done there instead, so the desktop
// render path keeps exactly the markup it had.
import { useEffect, useState } from 'react'

export const MOBILE_BREAKPOINT = 768

const query = () => typeof window !== 'undefined'
  && window.matchMedia
  && window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`)

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    const mq = query()
    return mq ? mq.matches : false
  })

  useEffect(() => {
    const mq = query()
    if (!mq) return
    const onChange = (e) => setIsMobile(e.matches)
    // addListener is the Safari/older-WebView spelling; some Android
    // System WebView builds still lack addEventListener here.
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    setIsMobile(mq.matches)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  return isMobile
}

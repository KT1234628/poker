'use client';

import { useEffect, useState } from 'react';

/** True when viewport width <= 768px and pointer is coarse. */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => {
      const narrow = window.innerWidth <= 768;
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      setIsMobile(narrow || coarse);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

'use client';

import { useEffect } from 'react';

export default function ConsoleSilencer() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ENABLE_DEBUG_LOGS === 'true') {
      return;
    }

    const originalLog = console.log;
    const originalInfo = console.info;
    const originalDebug = console.debug;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
    console.warn = () => {};

    // Hydration error filtering
    console.error = (...args: any[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      if (
        msg.includes('A tree hydrated but some attributes of the server rendered HTML didn\'t match') ||
        msg.includes('Hydration failed because the initial UI does not match') ||
        msg.includes('Text content did not match. Server:') ||
        msg.includes('There was an error while hydrating') ||
        msg.includes('Warning: Expected server HTML to contain a matching')
      ) {
        return;
      }
      originalError.apply(console, args);
    };

    return () => {
      console.log = originalLog;
      console.info = originalInfo;
      console.debug = originalDebug;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  return null;
}

// The device snapshot stored as report.device. One function, two runtimes: the
// CDP lane evaluates its source text inside the page (Runtime.evaluate), the
// inject lane's relay calls it directly. Keep it self-contained — no imports,
// no closures — or the toString() path breaks.
export function collectDeviceInfo() {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages,
    vendor: navigator.vendor,
    cookieEnabled: navigator.cookieEnabled,
    online: navigator.onLine,
    url: location.href,
    referrer: document.referrer,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: screen.width, height: screen.height, dpr: window.devicePixelRatio, colorDepth: screen.colorDepth },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    memory: performance.memory
      ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        }
      : null,
  };
}

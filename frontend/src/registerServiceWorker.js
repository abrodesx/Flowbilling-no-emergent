export function registerServiceWorker() {
  const isSupported = "serviceWorker" in navigator;
  const isSecure = window.location.protocol === "https:" || window.location.hostname === "localhost";

  if (!isSupported || !isSecure || process.env.NODE_ENV !== "production") {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

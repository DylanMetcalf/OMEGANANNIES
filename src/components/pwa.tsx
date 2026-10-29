"use client";
import { useEffect, useState } from "react";

/** Registers the service worker in production and offers a reload when a new version is ready. */
export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => { if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw); });
      });
    }).catch(() => {});
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
  }, []);
  if (!waiting) return null;
  return (
    <div role="status" className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-[12px] bg-navy px-4 py-3 text-[14px] text-white shadow-[var(--shadow-pop)] lg:bottom-6">
      A new version of the portal is ready.
      <button className="rounded-[8px] bg-white px-3 py-1.5 text-[13px] font-semibold text-navy" onClick={() => waiting.postMessage("skip-waiting")}>Reload</button>
    </div>
  );
}

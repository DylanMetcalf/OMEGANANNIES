"use client";
import { useEffect, useState } from "react";
import { pushLocationAction } from "@/app/nanny/actions";

/** Sends the device location only while sharing is active AND this page is open. No background tracking. */
export function LocationSharer({ bookingId, expiresAt }: { bookingId: string; expiresAt: string }) {
  const [state, setState] = useState<"idle" | "sending" | "denied" | "unsupported" | "error" | "ended">("idle");
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) { setState("unsupported"); return; }
    let stop = false;
    const tick = () => {
      if (stop) return;
      if (Date.now() > new Date(expiresAt).getTime()) { setState("ended"); return; }
      navigator.geolocation.getCurrentPosition(async (p) => {
        setState("sending");
        const r = await pushLocationAction(bookingId, p.coords.latitude, p.coords.longitude, p.coords.accuracy);
        if ("ok" in r) setLast(new Date().toLocaleTimeString()); else if (r.error === "inactive") setState("ended");
      }, (e) => setState(e.code === e.PERMISSION_DENIED ? "denied" : "error"), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => { stop = true; clearInterval(t); };
  }, [bookingId, expiresAt]);
  const msg = { idle: "Requesting location permission…", sending: `Sharing live${last ? ` · last sent ${last}` : ""}`, denied: "Location permission denied. Use a check-in note instead, or enable location in your browser settings.", unsupported: "This device can't share location. Use a check-in note instead.", error: "Couldn't get a location fix. We'll retry in a minute.", ended: "Sharing has ended." }[state];
  return <p role="status" className={`flex items-center gap-2 text-[14px] ${state === "denied" || state === "error" ? "text-bad" : ""}`}>{state === "sending" && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-ok" />}{msg}</p>;
}

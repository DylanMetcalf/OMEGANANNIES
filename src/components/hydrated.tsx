"use client";
import { useEffect } from "react";
/** Marks the document once React has hydrated (used by E2E tests to avoid racing pre-hydration clicks). */
export function Hydrated() {
  useEffect(() => { document.documentElement.dataset.hydrated = "1"; }, []);
  return null;
}

"use client";
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 text-center"><p className="eyebrow">Something went wrong</p><h1 className="mt-2 text-[32px]">We hit a problem loading this page</h1><p className="mt-3 text-muted">Your data is safe. Please try again — if it continues, contact Omega Nannies.</p><button onClick={reset} className="btn-primary mt-6">Try again</button></main>;
}

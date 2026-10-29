export default function Loading() {
  return <div className="mx-auto max-w-[1180px] animate-pulse px-8 py-10" aria-busy="true" aria-label="Loading"><div className="h-3 w-24 rounded bg-sand" /><div className="mt-3 h-9 w-72 rounded bg-sand" /><div className="mt-8 grid grid-cols-4 gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-white" />)}</div><div className="mt-6 h-64 rounded-xl bg-white" /></div>;
}

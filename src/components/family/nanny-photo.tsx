/**
 * Profile photo at a fixed aspect ratio. Images are scaled proportionally and cropped (object-cover) with the focal
 * point biased towards the face — never stretched. Without an approved photo, a calm monogram is shown instead.
 */
export function NannyPhoto({ name, src, ratio = "aspect-[4/5]", sizes = "(min-width:1280px) 300px, (min-width:768px) 45vw, 92vw", className = "", eager }: { name: string; src: string | null; ratio?: string; sizes?: string; className?: string; eager?: boolean }) {
  const initials = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <div className={`@container relative overflow-hidden bg-navy-50 ${ratio} ${className}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${src}?w=480`} srcSet={`${src}?w=480 480w, ${src}?w=960 960w`} sizes={sizes} alt={`Photo of ${name}`} loading={eager ? "eager" : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover object-[50%_28%]" />
      ) : (
        <div aria-hidden className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(160deg,#f4f5f9_0%,#e6e9f2_100%)]">
          <span className="font-display text-[22cqw] font-bold leading-none tracking-[-0.03em] text-navy/70">{initials}</span>
        </div>
      )}
    </div>
  );
}

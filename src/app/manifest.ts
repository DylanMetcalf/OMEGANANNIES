import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Omega Nannies", short_name: "Omega", description: "Bookings, schedules and messages for Omega Nannies families, nannies and team.",
    start_url: "/", scope: "/", display: "standalone", background_color: "#f7f6f3", theme_color: "#172038", orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "Stapli", short_name: "Stapli", description: "A shopping list that learns what your household buys.", start_url: "/app", display: "standalone", background_color: "#f8f7f2", theme_color: "#f8f7f2" };
}

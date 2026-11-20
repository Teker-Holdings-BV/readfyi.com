import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

// Required for `output: 'export'`: emits a static out/robots.txt at build time.
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Token-driven utility pages with no value in search results.
      disallow: ["/subscribers/", "/manage-subscriptions"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

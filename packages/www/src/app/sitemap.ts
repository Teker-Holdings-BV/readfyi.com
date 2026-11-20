import type { MetadataRoute } from "next";
import { NewsletterEnum } from "@readfyi/shared";
import { ROLE_PAGES } from "./newsletters/role-pages";
import { SITE_URL } from "@/lib/site-url";

// Required for `output: 'export'`: emits a static out/sitemap.xml at build time.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const newsletterIds = [
    ...Object.values(NewsletterEnum),
    ...Object.keys(ROLE_PAGES),
  ];

  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    ...newsletterIds.map((id) => ({
      url: `${SITE_URL}/newsletters/${id}`,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    { url: `${SITE_URL}/advertise`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/privacy-policy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}

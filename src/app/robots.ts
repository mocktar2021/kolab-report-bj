import type { MetadataRoute } from "next";
import { isIndexable, localizedPath, PRIVATE_PATHS, siteUrl } from "@/lib/seo/site";

// /robots.txt (KRB-258), written at build time. Production lets crawlers read
// the public pages and points them to the sitemap. Any other deployment shuts
// them out.
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/monitoring", ...PRIVATE_PATHS.map((path) => localizedPath(path))],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

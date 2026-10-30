import type { MetadataRoute } from "next";
import { INDEXED_PATHS, localizedPath, siteUrl } from "@/lib/seo/site";

// /sitemap.xml (KRB-258), written at build time: the public pages only, with
// full addresses. Search Console reads it once the site is verified (KRB-260).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return INDEXED_PATHS.map((path) => ({ url: `${base}${localizedPath(path)}` }));
}

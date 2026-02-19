import db from "~/lib/Database/supabase";
import { BASE_URL } from "~/lib/URLS";
import { filterFilesByAccess } from "../fun/accessControl";

const MAX_URLS_PER_SITEMAP = 50000;
const STATIC_PAGES = [
  { path: '', priority: '1.0', changefreq: 'daily' },
  { path: 'privacy', priority: '0.3', changefreq: 'monthly' },
  { path: 'terms', priority: '0.3', changefreq: 'monthly' },
  { path: 'search', priority: '0.8', changefreq: 'daily' },
  { path: 'features/incoming', priority: '0.5', changefreq: 'weekly' },
  { path: 'reel', priority: '0.9', changefreq: 'daily' },
];

const formatDate = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
};

const generateSitemapXML = (urls: Array<{
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}>): string => {
  const urlEntries = urls.map(url => {
    let entry = `    <url>\n      <loc>${url.loc}</loc>`;
    if (url.lastmod) {
      entry += `\n      <lastmod>${url.lastmod}</lastmod>`;
    }
    if (url.changefreq) {
      entry += `\n      <changefreq>${url.changefreq}</changefreq>`;
    }
    if (url.priority) {
      entry += `\n      <priority>${url.priority}</priority>`;
    }
    entry += `\n    </url>`;
    return entry;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${urlEntries}
</urlset>`;
};

const generateSitemapIndex = (sitemaps: Array<{ loc: string; lastmod: string }>): string => {
  const sitemapEntries = sitemaps.map(sitemap => 
    `    <sitemap>\n      <loc>${sitemap.loc}</loc>\n      <lastmod>${sitemap.lastmod}</lastmod>\n    </sitemap>`
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</sitemapindex>`;
};

export const loader = async ({ request }: { request: Request }) => {
  try {
    if (!db) {
      return new Response('Database not available', { status: 500 });
    }

    const url = new URL(request.url);
    const sitemapType = url.searchParams.get('type') || 'index';

    const sitemapRequest = new Request(request.url, {
      method: 'GET',
      headers: new Headers(),
    });

    if (sitemapType === 'profiles') {
      const { data: profiles, error } = await db
        .from('users')
        .select('username, created_at')
        .eq('is_memories', false)
        .order('created_at', { ascending: false })
        .limit(MAX_URLS_PER_SITEMAP);

      if (error) {
        console.error('Error fetching profiles:', error);
        return new Response('Error generating sitemap', { status: 500 });
      }

      const profileUrls = (profiles || []).map((profile: { username: string; created_at: string }) => ({
        loc: `${BASE_URL}/profile/${encodeURIComponent(profile.username)}`,
        lastmod: formatDate(profile.created_at),
        changefreq: 'weekly' as const,
        priority: '0.8',
      }));

      const xml = generateSitemapXML(profileUrls);

      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

    if (sitemapType === 'files') {
      const { data: feedFiles, error: feedError } = await db.rpc('get_feed', {
        p_user_id: null,
        p_limit: MAX_URLS_PER_SITEMAP,
        p_category: null,
        p_reels_only: false,
        p_seed: 'default',
        p_cursor_pos: 0,
        p_exclude_ids: []
      });

      if (feedError) {
        console.error('Error fetching feed for sitemap:', feedError);
        return new Response('Error generating sitemap', { status: 500 });
      }

      const filteredFiles = await filterFilesByAccess(sitemapRequest, (feedFiles || []) as unknown as any[]);

      const fileUrls = filteredFiles.map((file: any) => ({
        loc: `${BASE_URL}/${file.unique_id}`,
        lastmod: formatDate(file.created_at),
        changefreq: 'weekly' as const,
        priority: '0.7',
      }));

      const xml = generateSitemapXML(fileUrls);

      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

    if (sitemapType === 'index') {
      const sitemaps = [
        {
          loc: `${BASE_URL}/api/sitemap?type=main`,
          lastmod: formatDate(new Date()),
        },
        {
          loc: `${BASE_URL}/api/sitemap?type=profiles`,
          lastmod: formatDate(new Date()),
        },
        {
          loc: `${BASE_URL}/api/sitemap?type=files`,
          lastmod: formatDate(new Date()),
        },
      ];

      const xml = generateSitemapIndex(sitemaps);

      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

    if (sitemapType === 'main') {
      const staticUrls = STATIC_PAGES.map(page => ({
      loc: `${BASE_URL}${page.path ? `/${page.path}` : ''}`,
      lastmod: formatDate(new Date()),
      changefreq: page.changefreq as 'daily' | 'weekly' | 'monthly',
      priority: page.priority,
    }));

    const { data: recentProfiles } = await db
      .from('users')
      .select('username, created_at')
      .eq('is_memories', false)
      .order('created_at', { ascending: false })
      .limit(1000);

    const { data: feedFiles, error: feedError } = await db.rpc('get_feed', {
      p_user_id: null,
      p_limit: 1000,
      p_category: null,
      p_reels_only: false,
      p_seed: 'default',
      p_cursor_pos: 0,
      p_exclude_ids: []
    });

    const recentFiles = feedError ? [] : await filterFilesByAccess(sitemapRequest, (feedFiles || []) as unknown as any[]);

    type ProfileData = { username: string; created_at: string };
    type SitemapFileData = { id?: string; unique_id?: string; created_at: string };

    const profileUrls = ((recentProfiles || []) as ProfileData[]).map((profile) => ({
      loc: `${BASE_URL}/profile/${encodeURIComponent(profile.username)}`,
      lastmod: formatDate(profile.created_at),
      changefreq: 'weekly' as const,
      priority: '0.8',
    }));

    const fileUrls = (recentFiles || []).map((file: any) => ({
      loc: `${BASE_URL}/${file.unique_id}`,
      lastmod: formatDate(file.created_at),
      changefreq: 'weekly' as const,
      priority: '0.7',
    }));

      const allUrls = [...staticUrls, ...profileUrls, ...fileUrls];

      const xml = generateSitemapXML(allUrls);

      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

    return new Response('Invalid sitemap type', { status: 400 });
  } catch (error) {
    console.error('Error generating sitemap:', error);
    return new Response('Error generating sitemap', { status: 500 });
  }
};

import type { LoaderFunctionArgs } from "react-router";
import { isAuthenticated } from "~/lib/Security/Password";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    try {
        const user = await isAuthenticated(request, ["id"]);
        if (!user?.id) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }

        const url = new URL(request.url);
        
        const pathParts = url.pathname.split('/socials/info/');
        if (pathParts.length < 2 || !pathParts[1]) {
            return new Response(JSON.stringify({ error: 'URL parameter is required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        let targetUrl = decodeURIComponent(pathParts[1]);
        
        if (!targetUrl.includes('?') && url.search) {
            const testUrl = targetUrl + url.search;
            try {
                new URL(testUrl);
                targetUrl = testUrl;
            } catch {
            }
        }

        try {
            if (!targetUrl.match(/^https?:\/\//i)) {
                targetUrl = 'https://' + targetUrl;
            }
            new URL(targetUrl);
        } catch {
            return new Response(JSON.stringify({ error: 'Invalid URL format' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const targetUrlObj = new URL(targetUrl);
        const refererUrl = `${targetUrlObj.protocol}//${targetUrlObj.host}/`;

        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': refererUrl,
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1',
            },
            redirect: 'follow',
        });

        if (!response.ok) {
            return new Response(JSON.stringify({ 
                error: `Failed to fetch URL: ${response.status} ${response.statusText}` 
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const html = await response.text();
        
        const metadata: Record<string, any> = {
            url: targetUrl,
            title: '',
            description: '',
            image: '',
            images: [] as string[],
            siteName: '',
            type: '',
            video: '',
        };

        const resolveUrl = (url: string): string => {
            if (!url) return '';
            if (url.startsWith('http://') || url.startsWith('https://')) return url;
            if (url.startsWith('//')) return 'https:' + url;
            if (url.startsWith('/')) return new URL(url, targetUrl).href;
            return new URL(url, targetUrl).href;
        };

        const extractMetaTag = (html: string, property: string, attribute: string = 'property'): string => {
            if (attribute === 'name' && !property.startsWith('twitter:') && !property.startsWith('og:')) {
                const ogProperty = `og:${property}`;
                const ogResult = extractMetaTag(html, ogProperty, 'property');
                if (ogResult) return ogResult;
            }
            
            const patterns = [
                new RegExp(`<meta[^>]*${attribute}=["']${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i'),
                new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${property}["'][^>]*>`, 'i'),
                new RegExp(`<meta[^>]*${attribute}=["']${property}["'][^>]*content=[""]([^""]+)[""][^>]*>`, 'i'),
                new RegExp(`<meta[^>]*content=[""]([^""]+)[""][^>]*${attribute}=["']${property}["'][^>]*>`, 'i'),
            ];
            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) return match[1].trim();
            }
            return '';
        };

        const extractAllMetaTags = (html: string, property: string, attribute: string = 'property'): string[] => {
            const results: string[] = [];
            const patterns = [
                new RegExp(`<meta[^>]*${attribute}=["']${property}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'gi'),
                new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attribute}=["']${property}["'][^>]*>`, 'gi'),
                new RegExp(`<meta[^>]*${attribute}=["']${property}["'][^>]*content=[""]([^""]+)[""][^>]*>`, 'gi'),
                new RegExp(`<meta[^>]*content=[""]([^""]+)[""][^>]*${attribute}=["']${property}["'][^>]*>`, 'gi'),
            ];
            for (const pattern of patterns) {
                const matches = html.matchAll(pattern);
                for (const match of matches) {
                    if (match[1]) {
                        const value = match[1].trim();
                        if (value && !results.includes(value)) {
                            results.push(value);
                        }
                    }
                }
            }
            return results;
        };

        const extractAllOgTags = (html: string): Record<string, string[]> => {
            const ogTags: Record<string, string[]> = {};
            const ogMatches = html.matchAll(/<meta[^>]*(?:property|name)=["'](og:[^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi);
            for (const match of ogMatches) {
                const property = match[1].toLowerCase();
                const content = match[2].trim();
                if (content) {
                    if (!ogTags[property]) ogTags[property] = [];
                    if (!ogTags[property].includes(content)) ogTags[property].push(content);
                }
            }
            return ogTags;
        };

        const extractAllTwitterTags = (html: string): Record<string, string[]> => {
            const twitterTags: Record<string, string[]> = {};
            const twitterMatches = html.matchAll(/<meta[^>]*(?:property|name)=["'](twitter:[^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi);
            for (const match of twitterMatches) {
                const property = match[1].toLowerCase();
                const content = match[2].trim();
                if (content) {
                    if (!twitterTags[property]) twitterTags[property] = [];
                    if (!twitterTags[property].includes(content)) twitterTags[property].push(content);
                }
            }
            return twitterTags;
        };

        const extractJsonLd = (html: string): any[] => {
            const jsonLdMatches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
            const results: any[] = [];
            for (const match of jsonLdMatches) {
                try {
                    const json = JSON.parse(match[1].trim());
                    if (Array.isArray(json)) {
                        results.push(...json);
                    } else {
                        results.push(json);
                    }
                } catch (e) {
                }
            }
            return results;
        };

        const extractScriptJson = (html: string): any[] => {
            const scriptMatches = html.matchAll(/<script[^>]*>(.*?)<\/script>/gis);
            const results: any[] = [];
            for (const match of scriptMatches) {
                const content = match[1].trim();
                if (content.startsWith('{') || content.startsWith('[')) {
                    try {
                        const json = JSON.parse(content);
                        results.push(json);
                    } catch (e) {
                        if (content.includes('window._sharedData') || content.includes('__additionalDataLoaded')) {
                            const sharedDataMatch = content.match(/window\._sharedData\s*=\s*({.+?});/s);
                            if (sharedDataMatch) {
                                try {
                                    results.push(JSON.parse(sharedDataMatch[1]));
                                } catch (e) {
                                }
                            }
                        }
                    }
                }
            }
            return results;
        };

        const isDomainOnlyTitle = (title: string, url: string): boolean => {
            if (!title) return true;
            const titleLower = title.toLowerCase().trim();
            const urlObj = new URL(url);
            const domain = urlObj.hostname.toLowerCase().replace('www.', '');
            const domainVariations = [
                domain,
                `www.${domain}`,
                domain.split('.')[0],
                domain.replace('.com', '').replace('.net', '').replace('.org', ''),
            ];
            return domainVariations.some(d => titleLower === d || titleLower === `${d}.com`);
        };

        const allOgTags = extractAllOgTags(html);
        const allTwitterTags = extractAllTwitterTags(html);

        const ogTitle = extractMetaTag(html, 'og:title', 'property') || (allOgTags['og:title']?.[0] || '');
        const ogDescription = extractMetaTag(html, 'og:description', 'property') || (allOgTags['og:description']?.[0] || '');
        const ogSiteName = extractMetaTag(html, 'og:site_name', 'property') || (allOgTags['og:site_name']?.[0] || '');
        const ogType = extractMetaTag(html, 'og:type', 'property') || (allOgTags['og:type']?.[0] || '');
        const ogUrl = extractMetaTag(html, 'og:url', 'property') || (allOgTags['og:url']?.[0] || '');
        const ogVideo = extractMetaTag(html, 'og:video', 'property') || (allOgTags['og:video']?.[0] || '');
        const ogVideoUrl = extractMetaTag(html, 'og:video:url', 'property') || (allOgTags['og:video:url']?.[0] || '');
        const ogVideoSecureUrl = extractMetaTag(html, 'og:video:secure_url', 'property') || (allOgTags['og:video:secure_url']?.[0] || '');
        const ogVideoType = extractMetaTag(html, 'og:video:type', 'property') || (allOgTags['og:video:type']?.[0] || '');
        const ogVideoWidth = extractMetaTag(html, 'og:video:width', 'property') || (allOgTags['og:video:width']?.[0] || '');
        const ogVideoHeight = extractMetaTag(html, 'og:video:height', 'property') || (allOgTags['og:video:height']?.[0] || '');

        if (ogTitle && !isDomainOnlyTitle(ogTitle, targetUrl)) {
            metadata.title = ogTitle;
        }
        if (ogDescription) metadata.description = ogDescription;
        if (ogSiteName) metadata.siteName = ogSiteName;
        if (ogType) metadata.type = ogType;
        if (ogUrl) metadata.canonicalUrl = resolveUrl(ogUrl);
        if (ogVideo) metadata.video = resolveUrl(ogVideo);
        if (ogVideoUrl && !metadata.video) metadata.video = resolveUrl(ogVideoUrl);
        if (ogVideoSecureUrl && !metadata.video) metadata.video = resolveUrl(ogVideoSecureUrl);
        if (ogVideoType && !metadata.videoType) metadata.videoType = ogVideoType;
        if (ogVideoWidth) metadata.videoWidth = ogVideoWidth;
        if (ogVideoHeight) metadata.videoHeight = ogVideoHeight;

        const ogImages = extractAllMetaTags(html, 'og:image', 'property');
        for (const img of ogImages) {
            const imageUrl = resolveUrl(img);
            if (!metadata.images.includes(imageUrl)) metadata.images.push(imageUrl);
            if (!metadata.image) metadata.image = imageUrl;
        }

        const ogImageUrl = extractMetaTag(html, 'og:image:url', 'property');
        if (ogImageUrl) {
            const imgUrl = resolveUrl(ogImageUrl);
            if (!metadata.images.includes(imgUrl)) metadata.images.push(imgUrl);
            if (!metadata.image) metadata.image = imgUrl;
        }

        const ogImageSecureUrl = extractMetaTag(html, 'og:image:secure_url', 'property');
        if (ogImageSecureUrl) {
            const imgUrl = resolveUrl(ogImageSecureUrl);
            if (!metadata.images.includes(imgUrl)) metadata.images.push(imgUrl);
            if (!metadata.image) metadata.image = imgUrl;
        }

        const twitterTitle = extractMetaTag(html, 'twitter:title', 'name') || (allTwitterTags['twitter:title']?.[0] || '');
        const twitterDescription = extractMetaTag(html, 'twitter:description', 'name') || (allTwitterTags['twitter:description']?.[0] || '');
        const twitterImage = extractMetaTag(html, 'twitter:image', 'name') || (allTwitterTags['twitter:image']?.[0] || '');
        const twitterImageSrc = extractMetaTag(html, 'twitter:image:src', 'name') || (allTwitterTags['twitter:image:src']?.[0] || '');
        const twitterPlayer = extractMetaTag(html, 'twitter:player', 'name') || (allTwitterTags['twitter:player']?.[0] || '');
        const twitterPlayerStream = extractMetaTag(html, 'twitter:player:stream', 'name') || (allTwitterTags['twitter:player:stream']?.[0] || '');
        const twitterCard = extractMetaTag(html, 'twitter:card', 'name') || (allTwitterTags['twitter:card']?.[0] || '');
        const twitterSite = extractMetaTag(html, 'twitter:site', 'name') || (allTwitterTags['twitter:site']?.[0] || '');
        const twitterCreator = extractMetaTag(html, 'twitter:creator', 'name') || (allTwitterTags['twitter:creator']?.[0] || '');

        if (twitterTitle && (!metadata.title || isDomainOnlyTitle(metadata.title, targetUrl)) && !isDomainOnlyTitle(twitterTitle, targetUrl)) {
            metadata.title = twitterTitle;
        }
        if (twitterDescription && !metadata.description) metadata.description = twitterDescription;
        if (twitterImage && !metadata.image) {
            const imgUrl = resolveUrl(twitterImage);
            metadata.image = imgUrl;
            if (!metadata.images.includes(imgUrl)) metadata.images.push(imgUrl);
        }
        if (twitterImageSrc && !metadata.image) {
            const imgUrl = resolveUrl(twitterImageSrc);
            metadata.image = imgUrl;
            if (!metadata.images.includes(imgUrl)) metadata.images.push(imgUrl);
        }
        if (twitterPlayer && !metadata.video) metadata.video = resolveUrl(twitterPlayer);
        if (twitterPlayerStream && !metadata.video) metadata.video = resolveUrl(twitterPlayerStream);
        if (twitterCard) metadata.twitterCard = twitterCard;
        if (twitterSite && !metadata.siteName) metadata.siteName = twitterSite;
        if (twitterCreator && !metadata.siteName) metadata.siteName = twitterCreator;

        const jsonLdData = extractJsonLd(html);
        const scriptJsonData = extractScriptJson(html);

        for (const item of jsonLdData) {
            if (item['@type'] === 'VideoObject' || item['@type'] === 'ImageObject' || item['@type'] === 'Article' || item['@type'] === 'WebPage') {
                if (item.name && !metadata.title && !isDomainOnlyTitle(item.name, targetUrl)) {
                    metadata.title = item.name;
                }
                if (item.headline && !metadata.title && !isDomainOnlyTitle(item.headline, targetUrl)) {
                    metadata.title = item.headline;
                }
                if (item.description && !metadata.description) metadata.description = item.description;
                if (item.image) {
                    const img = typeof item.image === 'string' ? item.image : (item.image.url || item.image);
                    if (img) {
                        const imgUrl = resolveUrl(img);
                        if (!metadata.images.includes(imgUrl)) metadata.images.push(imgUrl);
                        if (!metadata.image) metadata.image = imgUrl;
                    }
                }
                if (item.contentUrl && item['@type'] === 'VideoObject') {
                    if (!metadata.video) metadata.video = resolveUrl(item.contentUrl);
                }
                if (item.embedUrl && !metadata.video) {
                    metadata.video = resolveUrl(item.embedUrl);
                }
            }
        }

        for (const data of scriptJsonData) {
            if (data && typeof data === 'object') {
                if (data.entry_data) {
                    const entryData = data.entry_data;
                    if (entryData.PostPage && entryData.PostPage[0]) {
                        const post = entryData.PostPage[0].graphql?.shortcode_media;
                        if (post) {
                            if (post.caption?.edges?.[0]?.node?.text && !metadata.description) {
                                metadata.description = post.caption.edges[0].node.text;
                            }
                            if (post.owner?.username && !metadata.siteName) {
                                metadata.siteName = `@${post.owner.username}`;
                            }
                            if (post.is_video && post.video_url && !metadata.video) {
                                metadata.video = resolveUrl(post.video_url);
                            }
                            if (post.display_url && !metadata.image) {
                                const imgUrl = resolveUrl(post.display_url);
                                metadata.image = imgUrl;
                                if (!metadata.images.includes(imgUrl)) metadata.images.push(imgUrl);
                            }
                            if (post.edge_sidecar_to_children?.edges) {
                                for (const edge of post.edge_sidecar_to_children.edges) {
                                    const node = edge.node;
                                    if (node.display_url) {
                                        const imgUrl = resolveUrl(node.display_url);
                                        if (!metadata.images.includes(imgUrl)) metadata.images.push(imgUrl);
                                    }
                                    if (node.is_video && node.video_url && !metadata.video) {
                                        metadata.video = resolveUrl(node.video_url);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        if (!metadata.title || isDomainOnlyTitle(metadata.title, targetUrl)) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
                const title = titleMatch[1].trim();
                if (!isDomainOnlyTitle(title, targetUrl)) {
                    metadata.title = title;
                }
            }
        }

        if (!metadata.title || isDomainOnlyTitle(metadata.title, targetUrl)) {
            const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            if (h1Match) {
                const h1Title = h1Match[1].trim();
                if (!isDomainOnlyTitle(h1Title, targetUrl)) {
                    metadata.title = h1Title;
                }
            }
        }

        if (!metadata.title || isDomainOnlyTitle(metadata.title, targetUrl)) {
            const h2Match = html.match(/<h2[^>]*>([^<]+)<\/h2>/i);
            if (h2Match) {
                const h2Title = h2Match[1].trim();
                if (!isDomainOnlyTitle(h2Title, targetUrl)) {
                    metadata.title = h2Title;
                }
            }
        }

        const metaDescription = extractMetaTag(html, 'description', 'name');
        if (metaDescription && !metadata.description) metadata.description = metaDescription;

        const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);
        if (canonicalMatch) {
            metadata.canonicalUrl = resolveUrl(canonicalMatch[1].trim());
        }

        if (metadata.images.length > 0 && !metadata.image) {
            metadata.image = metadata.images[0];
        }

        return new Response(JSON.stringify(metadata, null, 2), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });

    } catch (error) {
        console.error('Error fetching socials info:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch URL metadata' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

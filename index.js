const { Client, GatewayIntentBits, AuditLogEvent, ActivityType, EmbedBuilder } = require('discord.js');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => res.send('ระบบเก็บ Log 24 ชั่วโมงกำลังทำงาน!'));
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1535687188048511036';
const IG_PROXY_DOMAIN = 'oginstagram.com';
const FB_PROXY_DOMAIN = 'facebed.com';
const CACHE_TTL = 10 * 60 * 1000;
const IG_APP_ID = '936619743392459';
const IG_DOC_ID = process.env.IG_DOC_ID || '25531498899829322';
const metadataCache = new Map();

const INSTAGRAM_UA = 'Googlebot/2.1 (+http://www.google.com/bot.html)';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const DISCORD_BOT_UA = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)';
const FACEBOOK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

function getDateStr() {
    const dateString = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'numeric',
        year: 'numeric'
    }).format(new Date());

    const [day, month, yearCE] = dateString.split('/');
    return `${day}/${month}/${parseInt(yearCE) + 543}`;
}

function cleanUrl(url) {
    return url.replace(/[),.!?;:'"]+$/g, '');
}

function getSocialType(url) {
    try {
        const hostname = new URL(cleanUrl(url)).hostname.toLowerCase();

        if (['instagram.com', 'www.instagram.com'].includes(hostname)) return 'instagram';
        if (['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch'].includes(hostname)) return 'facebook';

        return null;
    } catch {
        return null;
    }
}

function convertSocialUrl(originalUrl) {
    try {
        const url = new URL(cleanUrl(originalUrl));
        const hostname = url.hostname.toLowerCase();

        if (['instagram.com', 'www.instagram.com'].includes(hostname)) {
            return `https://${IG_PROXY_DOMAIN}${url.pathname}${url.search}${url.hash}`;
        }

        if (['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch'].includes(hostname)) {
            return `https://${FB_PROXY_DOMAIN}${url.pathname}${url.search}${url.hash}`;
        }

        return null;
    } catch {
        return null;
    }
}

function decodeHtml(text = '') {
    return String(text)
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function stripHtml(text = '') {
    return decodeHtml(
        String(text)
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
    );
}

function limitText(text, max) {
    if (!text) return '';
    return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function formatCount(value) {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number') {
        return value.toLocaleString('en-US');
    }

    const text = String(value).trim();

    if (/^\d+$/.test(text)) {
        return Number(text).toLocaleString('en-US');
    }

    return text;
}

function formatStats(likes, comments) {
    const parts = [];

    if (likes !== null && likes !== undefined && likes !== '') {
        parts.push(`❤️ ${formatCount(likes)}`);
    }

    if (comments !== null && comments !== undefined && comments !== '') {
        parts.push(`💬 ${formatCount(comments)}`);
    }

    return parts.join(' • ');
}

function absoluteUrl(url, baseUrl) {
    if (!url) return null;

    try {
        return new URL(url, baseUrl).href;
    } catch {
        return null;
    }
}

function getMeta(html, name) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const patterns = [
        new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${escaped}["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${escaped}["'][^>]*>`, 'i')
    ];

    for (const regex of patterns) {
        const match = html.match(regex);
        if (match?.[1]) return decodeHtml(match[1].trim());
    }

    return null;
}

function getAlternateActivityJson(html, baseUrl) {
    const patterns = [
        /<link[^>]+rel=["'][^"']*alternate[^"']*["'][^>]+type=["']application\/activity\+json["'][^>]+href=["']([^"']+)["'][^>]*>/i,
        /<link[^>]+type=["']application\/activity\+json["'][^>]+rel=["'][^"']*alternate[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i
    ];

    for (const regex of patterns) {
        const match = html.match(regex);
        if (match?.[1]) return absoluteUrl(match[1], baseUrl);
    }

    return null;
}

function getCache(key) {
    const cached = metadataCache.get(key);

    if (!cached) return null;

    if (Date.now() - cached.timestamp > CACHE_TTL) {
        metadataCache.delete(key);
        return null;
    }

    return cached.data;
}

function setCache(key, data) {
    metadataCache.set(key, {
        timestamp: Date.now(),
        data
    });

    if (metadataCache.size > 500) {
        const oldestKey = metadataCache.keys().next().value;
        if (oldestKey) metadataCache.delete(oldestKey);
    }
}

function extractBalancedJson(text, start) {
    if (start < 0 || text[start] !== '{') return null;

    let depth = 0;
    let inString = false;

    for (let i = start; i < text.length; i++) {
        const char = text[i];

        if (inString) {
            if (char === '\\') i++;
            else if (char === '"') inString = false;
            continue;
        }

        if (char === '"') {
            inString = true;
        } else if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;

            if (depth === 0) {
                return text.slice(start, i + 1);
            }
        }
    }

    return null;
}

function normalizeInstagramMedia(node) {
    if (!node || typeof node !== 'object') return null;

    const user = node.user || node.owner || {};
    const children = Array.isArray(node.carousel_media) ? node.carousel_media : null;
    const first = children?.[0] || node;

    const pickVideo = item => item?.video_versions?.[0]?.url || null;
    const pickImage = item => item?.image_versions2?.candidates?.[0]?.url || item?.display_uri || item?.display_url || null;

    return {
        username: user.username || null,
        fullName: user.full_name || null,
        profilePicUrl: user.profile_pic_url || null,
        verified: !!user.is_verified,
        caption: node.caption?.text || null,
        likes: node.like_count ?? node.edge_media_preview_like?.count ?? node.edge_liked_by?.count ?? null,
        comments: node.comment_count ?? node.edge_media_to_comment?.count ?? null,
        views: node.play_count ?? node.ig_play_count ?? node.video_view_count ?? node.video_play_count ?? null,
        takenAt: node.taken_at || node.taken_at_timestamp || null,
        isVideo: !!pickVideo(first),
        videoUrl: pickVideo(first),
        imageUrl: pickImage(first),
        width: first.original_width || first.dimensions?.width || null,
        height: first.original_height || first.dimensions?.height || null,
        itemCount: children?.length || 1,
        children: children
            ? children.map(item => ({
                isVideo: !!pickVideo(item),
                videoUrl: pickVideo(item),
                imageUrl: pickImage(item)
            }))
            : null
    };
}

function normalizeGraphqlMedia(node) {
    if (!node || typeof node !== 'object') return null;

    let item = node;
    const children = node.edge_sidecar_to_children?.edges || null;

    if (children?.length) {
        item = children[0].node;
    }

    const captionEdges = node.edge_media_to_caption?.edges || [];
    const likes = node.edge_media_preview_like?.count ?? node.edge_liked_by?.count ?? null;
    const comments = node.edge_media_to_comment?.count ?? null;

    return {
        username: node.owner?.username || null,
        fullName: node.owner?.full_name || null,
        profilePicUrl: node.owner?.profile_pic_url || null,
        verified: !!node.owner?.is_verified,
        caption: captionEdges.length ? captionEdges[0].node.text : null,
        likes,
        comments,
        views: node.video_view_count ?? node.video_play_count ?? null,
        takenAt: node.taken_at_timestamp || null,
        isVideo: !!item.is_video,
        videoUrl: item.video_url || null,
        imageUrl: item.display_url || node.display_url || node.thumbnail_src || null,
        width: item.dimensions?.width || null,
        height: item.dimensions?.height || null,
        itemCount: children?.length || 1,
        children: children
            ? children.map(edge => ({
                isVideo: !!edge.node.is_video,
                videoUrl: edge.node.video_url || null,
                imageUrl: edge.node.display_url || null
            }))
            : null
    };
}

function parseInstagramOg(html, finalUrl) {
    const title = getMeta(html, 'og:title') || getMeta(html, 'twitter:title') || '';
    const description = getMeta(html, 'og:description') || getMeta(html, 'twitter:description') || '';
    const image = getMeta(html, 'og:image') || getMeta(html, 'twitter:image') || '';
    const ogUrl = getMeta(html, 'og:url') || '';

    let username = null;
    let fullName = null;
    let likes = null;
    let comments = null;
    let caption = null;

    const authorMatch = title.match(/^(.+?)\s*\(@([^)]+)\)/);

    if (authorMatch) {
        fullName = authorMatch[1].trim();
        username = authorMatch[2].trim();
    } else {
        const usernameMatch = ogUrl.match(/instagram\.com\/([A-Za-z0-9_.]+)\/(?:p|reel|reels|tv)\//i);

        if (usernameMatch) {
            username = usernameMatch[1];
        }
    }

    const statsMatch = decodeHtml(description).match(/^([\d,.KM]+)\s+likes?,\s+([\d,.KM]+)\s+comments?/i);

    if (statsMatch) {
        likes = statsMatch[1];
        comments = statsMatch[2];
    }

    const captionMatch = decodeHtml(description).match(/on\s+[A-Z][a-z]+\s+\d+,\s+\d{4}:\s*["“](.*)["”]\s*$/s);

    if (captionMatch) {
        caption = captionMatch[1].replace(/["”]\s*$/, '').trim();
    } else if (description && !statsMatch) {
        caption = stripHtml(description);
    }

    if (!image && !username) return null;

    return {
        username,
        fullName,
        profilePicUrl: null,
        caption,
        likes,
        comments,
        views: null,
        takenAt: null,
        isVideo: false,
        videoUrl: null,
        imageUrl: absoluteUrl(image, finalUrl),
        width: null,
        height: null,
        itemCount: 1
    };
}

async function fetchInstagramGooglebot(code) {
    try {
        const url = `https://www.instagram.com/p/${code}/`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': INSTAGRAM_UA,
                'Accept-Language': 'en-US,en;q=0.9'
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) return null;

        const html = await response.text();
        const finalUrl = response.url || url;

        let media = null;

        const index = html.indexOf('"xig_polaris_media":');

        if (index !== -1) {
            const start = html.indexOf('{', index);
            const raw = extractBalancedJson(html, start);

            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    const node = parsed.if_not_gated_logged_out || (parsed.media_type ? parsed : null);

                    if (node) {
                        media = normalizeInstagramMedia(node);
                    }
                } catch (error) {
                    console.log(`อ่าน xig_polaris_media ไม่สำเร็จ: ${error.message}`);
                }
            }
        }

        return {
            media,
            og: parseInstagramOg(html, finalUrl)
        };
    } catch (error) {
        console.log(`Instagram Googlebot request ไม่สำเร็จ: ${error.message}`);
        return null;
    }
}

async function fetchInstagramGraphql(code) {
    try {
        const body = new URLSearchParams({
            av: '0',
            __d: 'www',
            __user: '0',
            __a: '1',
            __comet_req: '7',
            lsd: 'AVqbxe3J_YA',
            fb_api_caller_class: 'RelayModern',
            fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery',
            variables: JSON.stringify({
                shortcode: code,
                fetch_comment_count: 40,
                parent_comment_count: 24,
                child_comment_count: 3,
                fetch_like_count: 10,
                fetch_tagged_user_count: null,
                fetch_preview_comment_count: 2,
                has_threaded_comments: true,
                hoisted_comment_id: null,
                hoisted_reply_id: null
            }),
            server_timestamps: 'true',
            doc_id: IG_DOC_ID
        });

        const response = await fetch('https://www.instagram.com/graphql/query/', {
            method: 'POST',
            headers: {
                'User-Agent': CHROME_UA,
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': 'csrftoken=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'X-CSRFToken': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                'X-IG-App-ID': IG_APP_ID,
                'X-Asbd-Id': '129477',
                'X-Fb-Friendly-Name': 'PolarisPostActionLoadPostQueryQuery',
                'Origin': 'https://www.instagram.com',
                'Referer': `https://www.instagram.com/p/${code}/`
            },
            body: body.toString(),
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) return null;

        const data = await response.json().catch(() => null);
        const node = data?.data?.xdt_shortcode_media || data?.data?.shortcode_media;

        return node ? normalizeGraphqlMedia(node) : null;
    } catch (error) {
        console.log(`Instagram GraphQL ไม่สำเร็จ: ${error.message}`);
        return null;
    }
}

async function fetchInstagramProfileFeed(username, code) {
    try {
        const response = await fetch(
            `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
            {
                headers: {
                    'User-Agent': CHROME_UA,
                    'X-IG-App-ID': IG_APP_ID
                },
                signal: AbortSignal.timeout(15000)
            }
        );

        if (!response.ok) return null;

        const data = await response.json().catch(() => null);
        const user = data?.data?.user;
        const edges = user?.edge_owner_to_timeline_media?.edges;

        if (!edges) return null;

        const edge = edges.find(item => item?.node?.shortcode === code);

        if (!edge?.node) return null;

        return normalizeGraphqlMedia({
            ...edge.node,
            owner: {
                username,
                full_name: user.full_name,
                is_verified: user.is_verified,
                profile_pic_url: user.profile_pic_url
            }
        });
    } catch (error) {
        console.log(`Instagram profile feed ไม่สำเร็จ: ${error.message}`);
        return null;
    }
}

async function fetchInstagramEmbedPage(code) {
    try {
        const url = `https://www.instagram.com/p/${code}/embed/captioned/`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': CHROME_UA,
                'Accept-Language': 'en-US,en;q=0.9'
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) return null;

        const html = await response.text();
        const gqlIndex = html.indexOf('\\"gql_data\\"');

        if (gqlIndex !== -1) {
            const raw = extractBalancedJson(html, html.indexOf('{', gqlIndex));

            if (raw) {
                try {
                    const decoded = JSON.parse(JSON.parse(`"${raw}"`));
                    const node = decoded?.shortcode_media || decoded?.xdt_shortcode_media;

                    if (node) return normalizeGraphqlMedia(node);
                } catch (error) {
                    console.log(`อ่าน Instagram embed JSON ไม่สำเร็จ: ${error.message}`);
                }
            }
        }

        const imageMatch = html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/i);
        const usernameMatch = html.match(/class="UsernameText"[^>]*>([^<]+)</i);

        if (imageMatch) {
            return {
                username: usernameMatch?.[1]?.trim() || null,
                fullName: null,
                profilePicUrl: null,
                caption: null,
                likes: null,
                comments: null,
                views: null,
                takenAt: null,
                isVideo: false,
                videoUrl: null,
                imageUrl: decodeHtml(imageMatch[1]),
                width: null,
                height: null,
                itemCount: 1
            };
        }

        return null;
    } catch (error) {
        console.log(`Instagram embed page ไม่สำเร็จ: ${error.message}`);
        return null;
    }
}

async function fetchInstagramMetadata(originalUrl) {
    const cleanedUrl = cleanUrl(originalUrl);
    const cached = getCache(cleanedUrl);

    if (cached) return cached;

    try {
        const original = new URL(cleanedUrl);

        let code = null;
        const path = original.pathname;

        const postMatch = path.match(/\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);

        if (postMatch) {
            code = postMatch[1];
        }

        if (!code && path.startsWith('/share/')) {
            try {
                const shareResponse = await fetch(`https://www.instagram.com${path}${original.search}`, {
                    headers: { 'User-Agent': CHROME_UA },
                    redirect: 'manual',
                    signal: AbortSignal.timeout(10000)
                });

                const location = shareResponse.headers.get('location');

                if (location) {
                    const resolved = new URL(location, 'https://www.instagram.com');
                    const match = resolved.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);

                    if (match) code = match[1];
                }
            } catch (error) {
                console.log(`Instagram share link resolve ไม่สำเร็จ: ${error.message}`);
            }
        }

        if (!code) return null;

        const googlebotResult = await fetchInstagramGooglebot(code);
        let media = googlebotResult?.media || null;
        const og = googlebotResult?.og || null;

        if (!media) {
            media = await fetchInstagramGraphql(code);
        }

        if (!media && og?.username) {
            media = await fetchInstagramProfileFeed(og.username, code);
        }

        if (!media) {
            media = await fetchInstagramEmbedPage(code);
        }

        if (!media && og?.imageUrl) {
            media = og;
        }

        if (!media) return null;

        if (og) {
            if (!media.username) media.username = og.username;
            if (!media.fullName) media.fullName = og.fullName;
            if (!media.caption) media.caption = og.caption;
            if (media.likes == null) media.likes = og.likes;
            if (media.comments == null) media.comments = og.comments;
            if (!media.imageUrl) media.imageUrl = og.imageUrl;
        }

        const imgIndex = Math.max(
            1,
            parseInt(original.searchParams.get('img_index') || '1', 10) || 1
        );

        let selectedImage = media.imageUrl;
        let selectedVideo = media.videoUrl;
        let selectedIsVideo = media.isVideo;

        if (Array.isArray(media.children) && media.children.length > 0) {
            const selected = media.children[Math.min(imgIndex - 1, media.children.length - 1)];

            if (selected) {
                selectedImage = selected.imageUrl || selectedImage;
                selectedVideo = selected.videoUrl || selectedVideo;
                selectedIsVideo = !!selected.isVideo;
            }
        }

        const result = {
            type: 'instagram',
            originalUrl: cleanedUrl,
            username: media.username,
            fullName: media.fullName,
            profilePicUrl: media.profilePicUrl,
            caption: media.caption,
            likes: media.likes,
            comments: media.comments,
            views: media.views,
            takenAt: media.takenAt,
            imageUrl: selectedImage,
            videoUrl: selectedVideo,
            isVideo: selectedIsVideo,
            itemCount: media.itemCount || 1
        };

        setCache(cleanedUrl, result);
        return result;
    } catch (error) {
        console.log(`Instagram metadata error: ${error.message}`);
        return null;
    }
}

async function fetchFacebookMetadata(originalUrl) {
    const cleanedUrl = cleanUrl(originalUrl);
    const cached = getCache(cleanedUrl);

    if (cached) return cached;

    const proxyUrl = convertSocialUrl(cleanedUrl);

    if (!proxyUrl) return null;

    try {
        const response = await fetch(proxyUrl, {
            headers: {
                'User-Agent': DISCORD_BOT_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            console.log(`Facebed ตอบ ${response.status}: ${proxyUrl}`);
            return null;
        }

        const html = await response.text();
        const finalUrl = response.url || proxyUrl;

        const author = getMeta(html, 'og:title') || getMeta(html, 'twitter:title') || '';
        const caption = getMeta(html, 'og:description') || getMeta(html, 'twitter:description') || '';
        const image = getMeta(html, 'og:image') || getMeta(html, 'twitter:image') || '';
        const siteName = getMeta(html, 'og:site_name') || '';

        let likes = null;
        let comments = null;
        let dateText = null;

        const siteParts = siteName
            .split('\n')
            .map(item => decodeHtml(item).trim())
            .filter(Boolean);

        if (siteParts.length >= 2) {
            dateText = siteParts[1];
        }

        const statsText = siteParts.slice(2).join(' ');

        const likesMatch = statsText.match(/(?:❤️|♥️)\s*([\d.,KM]+)/i);
        const commentsMatch = statsText.match(/💬\s*([\d.,KM]+)/i);

        if (likesMatch) likes = likesMatch[1];
        if (commentsMatch) comments = commentsMatch[1];

        const result = {
            type: 'facebook',
            originalUrl: cleanedUrl,
            fullName: stripHtml(author),
            username: null,
            profilePicUrl: null,
            caption: stripHtml(caption),
            likes,
            comments,
            dateText,
            imageUrl: absoluteUrl(image, finalUrl),
            videoUrl: getMeta(html, 'og:video') || getMeta(html, 'twitter:player:stream') || null,
            isVideo: !!(getMeta(html, 'og:video') || getMeta(html, 'twitter:player:stream'))
        };

        if (!result.fullName && !result.caption && !result.imageUrl) return null;

        setCache(cleanedUrl, result);
        return result;
    } catch (error) {
        console.log(`Facebook metadata error: ${error.message}`);
        return null;
    }
}

async function fetchSocialMetadata(originalUrl) {
    const type = getSocialType(originalUrl);

    if (type === 'instagram') {
        return fetchInstagramMetadata(originalUrl);
    }

    if (type === 'facebook') {
        return fetchFacebookMetadata(originalUrl);
    }

    return null;
}

function buildSocialEmbed(data) {
    const isInstagram = data.type === 'instagram';
    const serviceName = isInstagram ? 'Instagram' : 'Facebook';
    const color = isInstagram ? 0xE1306C : 0x1877F2;

    const ownerName = data.fullName || data.username || serviceName;
    const ownerLine = data.username && data.fullName
        ? `${data.fullName} (@${data.username.replace(/^@/, '')})`
        : ownerName;

    const stats = formatStats(data.likes, data.comments);
    const caption = limitText(stripHtml(data.caption || ''), 150);

    let description = '';

    if (stats) {
        description += `${stats}\n\n`;
    }

    if (caption) {
        description += caption;
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setURL(data.originalUrl)
        .setFooter({ text: serviceName });

    if (ownerLine) {
        embed.setAuthor({
            name: limitText(ownerLine, 256),
            url: data.originalUrl,
            ...(data.profilePicUrl ? { iconURL: data.profilePicUrl } : {})
        });
    }

    if (description) {
        embed.setDescription(description);
    }

    if (data.imageUrl) {
        embed.setImage(data.imageUrl);
    }

    if (data.takenAt) {
        const timestamp = Number(data.takenAt);

        if (Number.isFinite(timestamp)) {
            embed.setTimestamp(
                new Date(
                    timestamp > 1000000000000
                        ? timestamp
                        : timestamp * 1000
                )
            );
        }
    }

    return embed;
}

client.on('voiceStateUpdate', (oldState, newState) => {
    const logChannel = newState.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const member = newState.member;
    if (!member || member.user.bot) return;

    const dateStr = getDateStr();
    const channelName = newState.channel?.name || oldState.channel?.name || 'ไม่ทราบห้อง';

    if (!oldState.channelId && newState.channelId) logChannel.send(`${dateStr} <@${member.id}> เข้า **${channelName}**`);
    else if (oldState.channelId && !newState.channelId) logChannel.send(`${dateStr} <@${member.id}> ออก **${channelName}**`);
    else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) logChannel.send(`${dateStr} <@${member.id}> ย้ายจาก **${oldState.channel.name}** ไป **${channelName}**`);

    if (!oldState.selfMute && newState.selfMute) logChannel.send(`${dateStr} 🎙️ <@${member.id}> **ปิดไมค์**`);
    else if (oldState.selfMute && !newState.selfMute) logChannel.send(`${dateStr} 🎙️ <@${member.id}> **เปิดไมค์**`);

    if (!oldState.selfDeaf && newState.selfDeaf) logChannel.send(`${dateStr} 🔈 <@${member.id}> **ปิดหูฟัง/ลำโพง**`);
    else if (oldState.selfDeaf && !newState.selfDeaf) logChannel.send(`${dateStr} 🔊 <@${member.id}> **เปิดหูฟัง/ลำโพง**`);

    if (!oldState.selfVideo && newState.selfVideo) logChannel.send(`${dateStr} 📹 <@${member.id}> เริ่ม **เปิดกล้อง** ในห้อง **${channelName}**`);
    else if (oldState.selfVideo && !newState.selfVideo) logChannel.send(`${dateStr} 📹 <@${member.id}> **ปิดกล้อง** ในห้อง **${channelName}**`);

    if (!oldState.streaming && newState.streaming) logChannel.send(`${dateStr} 🛑 <@${member.id}> เริ่ม **สตรีมหน้าจอ** ในห้อง **${channelName}**`);
    else if (oldState.streaming && !newState.streaming) logChannel.send(`${dateStr} 🛑 <@${member.id}> **หยุดสตรีมหน้าจอ** ในห้อง **${channelName}**`);
});

client.on('messageDelete', async message => {
    if (!message.guild) return;

    const logChannel = message.guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const dateStr = getDateStr();
    const authorTag = message.author ? `<@${message.author.id}>` : 'ไม่ทราบผู้ใช้';
    let executorTag = `${authorTag} ลบเอง`;

    try {
        const fetchedLogs = await message.guild.fetchAuditLogs({
            limit: 1,
            type: AuditLogEvent.MessageDelete
        });

        const deletionLog = fetchedLogs.entries.first();

        if (deletionLog) {
            const { executor, target, createdTimestamp } = deletionLog;

            if (message.author && target && target.id === message.author.id && createdTimestamp > Date.now() - 5000) {
                executorTag = `<@${executor.id}>`;
            }
        }
    } catch {
        console.log('บอทอ่าน Audit Log ไม่ได้ หรือไม่มีสิทธิ์');
    }

    let contentLog = `🗑️ ${dateStr} | ลบข้อความของ ${authorTag}\nคนลบ : ${executorTag} | ช่อง : <#${message.channel.id}>`;

    if (message.content) {
        contentLog += `\n"${message.content}"`;
    }

    await logChannel.send(contentLog);

    if (message.attachments.size > 0) {
        const attachmentUrls = [...message.attachments.values()].map(attachment => attachment.url);
        await logChannel.send(attachmentUrls.join('\n'));
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const content = message.content;

    const socialRegex = /(https?:\/\/(?:www\.)?(?:instagram\.com|facebook\.com|m\.facebook\.com|fb\.watch)\/[^\s<]+)/gi;
    const matches = content.match(socialRegex);

    if (matches?.length) {
        const uniqueUrls = [...new Set(matches.map(cleanUrl))].slice(0, 5);
        const metadataList = await Promise.all(uniqueUrls.map(fetchSocialMetadata));
        const validMetadata = metadataList.filter(Boolean);

        if (validMetadata.length > 0) {
            const embeds = validMetadata.map(buildSocialEmbed).slice(0, 10);

            try {
                await message.reply({
                    embeds,
                    allowedMentions: { repliedUser: false }
                });

                setTimeout(() => {
                    message.suppressEmbeds(true).catch(error => {
                        console.log(`ซ่อน Embed ต้นฉบับไม่ได้: ${error.message}`);
                    });
                }, 500);
            } catch (error) {
                console.log(`ส่ง Social Embed ไม่สำเร็จ: ${error.message}`);
            }

            return;
        }

        console.log(`ไม่สามารถสร้าง Social Embed ได้: ${uniqueUrls.join(', ')}`);
    }

    if (content.startsWith('/img')) {
        const targetUser = message.mentions.users.first() || message.author;
        const avatarUrl = targetUser.displayAvatarURL({ size: 4096, dynamic: true });
        return message.reply(`profile **${targetUser.username}**\n${avatarUrl}`);
    }

    const greetings = ['สวัสดีครับ', 'สวัสดีค่ะ', 'ดีครับ', 'ดีค่ะ', 'ดีจ้า', 'สวัสดีจ้า'];

    if (greetings.some(word => content.includes(word))) {
        return message.reply('โฮ่ง!');
    }

    if (content.includes('คิดถึงหมาคีตะ') || content.includes('คืดถึงหมาคีตะ')) {
        return message.reply('แห่ะๆ');
    } else if (content.includes('คิดถึงคีตะ')) {
        return message.reply('คิดถึงเหมือนกันครับ');
    } else if (content.includes('หมาคีตะ')) {
        return message.reply('บ๊อกๆ');
    }
});

client.on('messageUpdate', (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot || !oldMessage.content || !newMessage.content) return;

    if (oldMessage.content !== newMessage.content) {
        const logChannel = newMessage.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (!logChannel) return;

        const dateStr = getDateStr();
        const authorTag = `<@${newMessage.author.id}>`;
        const editLog = `✏️ ${dateStr} | แก้ไขข้อความ\nผู้ส่ง: ${authorTag} | ช่อง : <#${newMessage.channel.id}>\n"${oldMessage.content}"เป็น : "${newMessage.content}"`;

        logChannel.send(editLog);
    }
});

const statusList = [
    { name: 'custom', type: ActivityType.Custom, state: 'โฮ่ง' },
    { name: 'custom', type: ActivityType.Custom, state: 'หมามองไร' },
    { name: 'custom', type: ActivityType.Custom, state: 'คิดถึงกันมั้ย' },
    { name: 'custom', type: ActivityType.Custom, state: 'คิดถึงอะดิ้' },
    { name: 'custom', type: ActivityType.Custom, state: 'เห่า' },
    { name: 'custom', type: ActivityType.Custom, state: 'หอน' },
    { name: 'custom', type: ActivityType.Custom, state: 'ดีจ้า' },
    { name: 'custom', type: ActivityType.Custom, state: 'คิดถึงนะ' },
    { name: 'custom', type: ActivityType.Custom, state: 'หิววว' },
    { name: 'หมาที่ส่องโปรไฟล์', type: ActivityType.Watching },
    { name: 'หมาที่อยู่ในดิส', type: ActivityType.Watching },
    { name: 'เรื่องข้างบ้าน', type: ActivityType.Listening },
    { name: 'หมาเห่ากัน', type: ActivityType.Listening }
];

function setRandomStatus() {
    if (!client.user) return;

    const randomStatus = statusList[Math.floor(Math.random() * statusList.length)];
    client.user.setPresence({ activities: [randomStatus] });
}

/* ================================
   Discord Error Logging
   ================================ */

client.on('error', error => {
    console.error('❌ Discord Client Error:', error);
});

client.on('warn', warning => {
    console.warn('⚠️ Discord Warning:', warning);
});

client.on('shardError', error => {
    console.error('❌ Discord Shard Error:', error);
});

client.once('ready', () => {
    console.log(`✅ บอท ${client.user.tag} ออนไลน์ (Render)`);
    setRandomStatus();

    const SEVENTEEN_DAYS_MS = 17 * 24 * 60 * 60 * 1000;
    setInterval(setRandomStatus, SEVENTEEN_DAYS_MS);
});

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log('✅ Discord login เริ่มต้นสำเร็จ');
    })
    .catch(error => {
        console.error('❌ Discord Login Failed:', error);
    });

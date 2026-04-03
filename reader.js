#!/usr/bin/env node

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const GOOGLEBOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const PAYWALL_HINTS = [
  'subscribe to read', 'subscription required', 'sign in to continue',
  'create an account', 'register to read', 'paywall', 'premium content',
  'members only', 'subscriber-only', 'already a subscriber',
  'continue reading with', 'unlock this article', 'get unlimited access',
];

// HTML entity decoding.
const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&ndash;': '-',
  '&mdash;': '--',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&hellip;': '...',
};

function decodeEntities(text) {
  let out = text.replace(/&\w+;/g, (m) => ENTITIES[m] ?? m);
  out = out.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  return out;
}

// Tag helpers.
function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

function stripBlocks(html) {
  const blocks =
    /<(script|style|nav|header|footer|aside|iframe|form|button|svg|noscript|figcaption)[\s\S]*?<\/\1>/gi;
  let prev;
  do {
    prev = html;
    html = html.replace(blocks, '');
  } while (html !== prev);
  return html;
}

function meta(html, prop) {
  // Matches both property="X" content="Y" and content="Y" property="X" orderings.
  const r1 = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*?)["']`, 'i');
  const r2 = new RegExp(`<meta[^>]+content=["']([^"']*?)["'][^>]+(?:property|name)=["']${prop}["']`, 'i');
  return (html.match(r1)?.[1] ?? html.match(r2)?.[1] ?? '').trim();
}

// Extract metadata.
function extractTitle(html) {
  return (
    meta(html, 'og:title') ||
    decodeEntities(stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').trim()) ||
    decodeEntities(stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim())
  );
}

function extractAuthor(html) {
  let author = '';
  // Try JSON-LD first.
  try {
    const ld = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (ld) {
      const json = JSON.parse(ld[1]);
      const obj = Array.isArray(json) ? json[0] : json;
      const a = obj.author;
      author = Array.isArray(a) ? a.map((x) => x.name).join(', ') : a?.name ?? '';
    }
  } catch {}

  // Fallback to meta tags, but skip if it looks like a URL.
  if (!author) {
    const m = meta(html, 'author') || meta(html, 'article:author');
    if (m && !m.startsWith('http')) author = m;
  }
  return decodeEntities(author.trim());
}

function extractDate(html) {
  let date = meta(html, 'article:published_time');
  if (!date) {
    date = html.match(/<time[^>]*datetime=["']([^"']*?)["']/i)?.[1] ?? '';
  }
  if (!date) {
    try {
      const ld = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (ld) {
        const json = JSON.parse(ld[1]);
        const obj = Array.isArray(json) ? json[0] : json;
        date = obj.datePublished ?? '';
      }
    } catch {}
  }
  if (date) {
    try {
      return new Date(date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch {}
  }
  return date.trim();
}

// Extract body.
function extractBody(html) {
  // Try <article> first, then common content containers.
  let content = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1];

  if (!content) {
    const selectors = [
      /class=["'][^"']*article[_-]?body[^"']*["']/i,
      /class=["'][^"']*post[_-]?content[^"']*["']/i,
      /class=["'][^"']*entry[_-]?content[^"']*["']/i,
      /class=["'][^"']*story[_-]?body[^"']*["']/i,
      /class=["'][^"']*article[_-]?content[^"']*["']/i,
    ];
    for (const sel of selectors) {
      const idx = html.search(sel);
      if (idx !== -1) {
        // Find the matching closing div.
        let depth = 0;
        const start = html.indexOf('>', idx) + 1;
        let i = start;
        while (i < html.length) {
          if (html.startsWith('<div', i)) depth++;
          if (html.startsWith('</div', i)) {
            if (depth === 0) {
              content = html.slice(start, i);
              break;
            }
            depth--;
          }
          i++;
        }
        if (content) break;
      }
    }
  }

  if (!content) {
    // Last resort: gather all <p> tags longer than 40 chars.
    const ps = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
    content = ps
      .map((m) => m[1])
      .filter((p) => stripTags(p).trim().length > 40)
      .join('\n\n');
  }

  content = content.replace(/<h1[\s\S]*?<\/h1>/gi, '');
  content = stripBlocks(content);

  content = content.replace(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/gi, (_, t) => `\n\n## ${stripTags(t).trim()}\n\n`);
  content = content.replace(/<\/p>/gi, '\n\n');
  content = content.replace(/<br\s*\/?>/gi, '\n');
  content = content.replace(/<li[^>]*>/gi, '  - ');
  content = content.replace(/<\/li>/gi, '\n');

  content = stripTags(content);
  content = decodeEntities(content);

  content = content
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return content;
}

// Detect if fetched content looks paywalled.
function looksPaywalled(html) {
  const body = extractBody(html);
  if (body.length < 200) return true;
  const lower = html.toLowerCase();
  return PAYWALL_HINTS.some((hint) => lower.includes(hint));
}

// Fetch a URL with a given UA and optional extra headers, return null on failure.
async function tryFetch(url, ua, extraHeaders = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': ua, Accept: 'text/html', ...extraHeaders },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Build Google AMP cache URL from an article URL.
function ampCacheUrl(url) {
  try {
    const u = new URL(url);
    const ampDomain = u.hostname.replace(/-/g, '--').replace(/\./g, '-');
    return `https://${ampDomain}.cdn.ampproject.org/c/s/${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

// Check if a URL is a Medium article.
function isMediumUrl(url) {
  return /medium\.com|towardsdatascience\.com|betterprogramming\.pub|levelup\.gitconnected\.com/.test(url);
}

// Detect Google/cookie consent pages.
function isConsentPage(html) {
  const lower = html.toLowerCase();
  return lower.includes('consent.google') ||
    lower.includes('bevor sie zu google') ||
    lower.includes('before you continue to google') ||
    lower.includes('consent.youtube') ||
    (lower.includes('cookie') && lower.includes('consent') && !lower.includes('<article'));
}

// Try multiple sources to get the best article content.
async function fetchWithFallbacks(url) {
  // 1. Direct fetch with Chrome UA.
  let html = await tryFetch(url, CHROME_UA);
  if (html && !looksPaywalled(html)) return { html, via: 'direct' };

  // 2. Retry with Googlebot UA.
  const botHtml = await tryFetch(url, GOOGLEBOT_UA);
  if (botHtml && !looksPaywalled(botHtml)) return { html: botHtml, via: 'googlebot' };

  // 3. Try Google AMP Cache.
  const ampUrl = ampCacheUrl(url);
  if (ampUrl) {
    const ampHtml = await tryFetch(ampUrl, CHROME_UA);
    if (ampHtml && ampHtml.length > 1000 && !looksPaywalled(ampHtml)) return { html: ampHtml, via: 'google-amp' };
  }

  // 4. Try archive.today (newest archived snapshot).
  for (const domain of ['archive.ph', 'archive.today', 'archive.is']) {
    const archiveHtml = await tryFetch(`https://${domain}/newest/${url}`, CHROME_UA);
    if (archiveHtml && archiveHtml.length > 2000 && !looksPaywalled(archiveHtml)) {
      return { html: archiveHtml, via: domain };
    }
  }

  // 5. Try Google Cache.
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}&hl=en&gl=us`;
  const cacheHtml = await tryFetch(cacheUrl, CHROME_UA);
  if (cacheHtml && cacheHtml.length > 1000 && !isConsentPage(cacheHtml)) return { html: cacheHtml, via: 'google-cache' };

  // 6. Try Wayback Machine (most recent snapshot).
  try {
    const wbRes = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': CHROME_UA },
    });
    if (wbRes.ok) {
      const wbJson = await wbRes.json();
      const snapUrl = wbJson?.archived_snapshots?.closest?.url;
      if (snapUrl) {
        const wbHtml = await tryFetch(snapUrl, CHROME_UA);
        if (wbHtml && wbHtml.length > 1000) return { html: wbHtml, via: 'wayback' };
      }
    }
  } catch {}

  // 7. Return whatever we got (even if paywalled).
  if (html) return { html, via: 'direct (paywalled)' };
  throw new Error('Could not fetch article from any source.');
}

// Main CLI entrypoint.
async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error('Usage: article-reader <url>');
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    console.error('Error: Invalid URL');
    process.exit(1);
  }

  try {
    const { html, via } = await fetchWithFallbacks(url);
    const width = Math.min(process.stdout.columns || 72, 80);
    const line = '='.repeat(width);
    const thin = '-'.repeat(width);

    const title = extractTitle(html);
    const author = extractAuthor(html);
    const date = extractDate(html);
    const body = extractBody(html);

    console.log();
    console.log(line);
    console.log(title || '(No title found)');
    console.log(line);
    if (author) console.log(`Author: ${author}`);
    if (date) console.log(`Date:   ${date}`);
    console.log(`Source: ${url}`);
    if (via !== 'direct') console.log(`Via:    ${via}`);
    console.log(thin);
    console.log();
    console.log(body || '(Could not extract article body)');
    console.log();
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();

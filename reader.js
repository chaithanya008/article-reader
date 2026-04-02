#!/usr/bin/env node

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });

    if (!res.ok) {
      console.error(`Error: HTTP ${res.status} ${res.statusText}`);
      process.exit(1);
    }

    const html = await res.text();
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

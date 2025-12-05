/**
 * URL expansion: fetch web pages and convert to Markdown
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { alignTables } from './markdown.ts';
import { output } from './output.ts';

const FETCH_TIMEOUT_MS = 30_000;

// Tracking parameters to strip from URLs
const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'ref',
  'source',
  'mc_cid',
  'mc_eid',
];

export interface UrlExpansionResult {
  title: string | null;
  content: string;
  finalUrl: string;
}

/**
 * Fetch and convert a URL to Markdown
 * Throws on failure - caller handles error formatting
 */
export async function expandUrl(url: string): Promise<UrlExpansionResult> {
  output.fetchStart(url);

  try {
    const { html, finalUrl } = await fetchUrl(url);
    const { title, content: htmlContent } = extractContent(html, finalUrl);
    let markdown = convertToMarkdown(htmlContent, finalUrl);

    // Align tables for readability
    markdown = alignTables(markdown);

    output.fetchSuccess(url, markdown.length);

    return {
      title,
      content: markdown,
      finalUrl,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    output.fetchError(url, message);
    throw error;
  }
}

/**
 * Check if a reference is a URL
 */
export function isUrl(ref: string): boolean {
  return ref.startsWith('http://') || ref.startsWith('https://');
}

/**
 * Fetch URL with timeout and redirect following
 */
async function fetchUrl(url: string): Promise<{ html: string; finalUrl: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Present as a browser to avoid bot blocking
        'User-Agent': 'Mozilla/5.0 (compatible; AskCLI/1.0; +https://github.com/rana/ask)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      throw new Error(`Not an HTML page (${contentType.split(';')[0]})`);
    }

    const html = await response.text();
    const finalUrl = response.url; // After redirects

    return { html, finalUrl };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }

    throw new Error('Unknown fetch error');
  }
}

/**
 * Extract readable content from HTML using Readability
 * Falls back to body text if Readability fails
 */
function extractContent(html: string, url: string): { title: string | null; content: string } {
  const dom = new JSDOM(html, { url });
  const document = dom.window.document;

  // Try Readability first
  const reader = new Readability(document.cloneNode(true) as Document);
  const article = reader.parse();

  if (article?.content && article.content.trim().length > 100) {
    return {
      title: article.title || null,
      content: article.content, // HTML content for Turndown
    };
  }

  // Fallback: extract body HTML directly
  const body = document.body;
  if (body) {
    // Remove script and style elements
    const scripts = body.querySelectorAll('script, style, noscript, nav, footer, header');
    for (const el of scripts) {
      el.remove();
    }

    const html = body.innerHTML?.trim();
    if (html && html.length > 50) {
      return {
        title: document.title || null,
        content: html,
      };
    }
  }

  throw new Error('No extractable content');
}

/**
 * Convert HTML to Markdown using Turndown
 */
function convertToMarkdown(html: string, baseUrl: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });

  // Enable GFM features (tables, strikethrough, task lists)
  turndown.use(gfm);

  // Remove images entirely (can't use them in API context)
  turndown.addRule('removeImages', {
    filter: 'img',
    replacement: () => '',
  });

  // Remove iframes
  turndown.addRule('removeIframes', {
    filter: 'iframe',
    replacement: () => '',
  });

  // Clean up links: resolve relative URLs and strip tracking params
  turndown.addRule('cleanLinks', {
    filter: 'a',
    replacement: (content, node) => {
      const element = node as HTMLAnchorElement;
      const href = element.getAttribute('href');

      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        return content;
      }

      try {
        const resolvedUrl = new URL(href, baseUrl);

        // Strip tracking parameters
        for (const param of TRACKING_PARAMS) {
          resolvedUrl.searchParams.delete(param);
        }

        const cleanUrl = resolvedUrl.toString();

        // Don't link if text matches URL (avoid redundant [url](url))
        if (content.trim() === cleanUrl || content.trim() === href) {
          return cleanUrl;
        }

        return `[${content}](${cleanUrl})`;
      } catch {
        // Invalid URL, return content only
        return content;
      }
    },
  });

  let markdown = turndown.turndown(html);

  // Clean up excessive whitespace
  markdown = markdown
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/^\s+|\s+$/g, ''); // Trim

  return markdown;
}

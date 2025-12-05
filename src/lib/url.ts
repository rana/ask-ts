import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { output } from './output.ts';

export function isUrl(ref: string): boolean {
  return ref.startsWith('http://') || ref.startsWith('https://');
}

export interface UrlContent {
  title: string | null;
  content: string;
}

export async function expandUrl(url: string): Promise<UrlContent> {
  output.fetchStart(url);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ask-cli/1.0)',
      Accept: 'text/html,application/xhtml+xml,text/plain,text/markdown',
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  // Plain text or markdown - return as-is
  if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
    return { title: null, content: text };
  }

  // HTML - parse with linkedom
  if (contentType.includes('text/html')) {
    return parseHtml(text, url);
  }

  // Unknown - return raw
  return { title: null, content: text };
}

function parseHtml(html: string, url: string): UrlContent {
  const { document } = parseHTML(html);

  // Set URL for Readability (it uses baseURI)
  Object.defineProperty(document, 'baseURI', { value: url });

  // Cast to any - linkedom's Document is compatible enough for Readability
  const reader = new Readability(document as any);
  const article = reader.parse();

  if (!article) {
    // Fallback: just get body text
    const body = document.body;
    const title = document.querySelector('title')?.textContent || null;
    return {
      title,
      content: body?.textContent?.trim() || '',
    };
  }

  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });
  turndown.use(gfm);

  const markdown = turndown.turndown(article.content);

  return {
    title: article.title ?? null,
    content: markdown,
  };
}
import { UpstreamServiceError } from './errors.js';

type PageLike = {
  goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
  wait: (seconds: number) => Promise<any>;
  evaluate: (js: string) => Promise<any>;
};

export type WosFullTextLink = { label: string; url: string };

/**
 * Scrape full-text links and body text from a WoS full-record page.
 * Navigates to the record URL, clicks "Full Text Links" button if present,
 * then extracts and filters visible links to find full-text entries.
 *
 * Shared between record.ts and full-text.ts to keep filtering rules in one place.
 */
export async function scrapeWosFullTextLinks(
  page: PageLike,
  url: string,
): Promise<Array<WosFullTextLink>> {
  await page.goto(url, { settleMs: 5000 });
  await page.wait(3);

  const result = await page.evaluate(`(async () => {
    const normalize = (text) => String(text || '')
      .replace(/\\u00a0/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };

    const fullTextButton = Array.from(document.querySelectorAll('button'))
      .find((el) => isVisible(el) && /full text links/i.test(String(el.textContent || '')));
    if (fullTextButton) {
      fullTextButton.click();
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    const allLinks = Array.from(document.querySelectorAll('a'))
      .map((el) => ({
        label: normalize(el.textContent || el.getAttribute('aria-label') || ''),
        url: String(el.href || '').trim(),
      }))
      .filter((item) => item.url);

    const filtered = [];
    const seen = new Set();
    for (const item of allLinks) {
      const hay = (item.label + ' ' + item.url).toLowerCase();
      if (hay.includes('google scholar')) continue;
      if (hay.includes('journal citation reports')) continue;
      if (hay.includes('journal citation indicator')) continue;
      if (hay.includes('accessibility')) continue;
      if (hay.includes('/wos/pqdt/')) continue;
      const isFullText = hay.includes('context sensitive')
        || hay.includes('free full text')
        || hay.includes('view full text')
        || hay.includes('full text on proquest')
        || hay.includes('repository')
        || hay.includes('submitted article')
        || hay.includes('getftr')
        || /\\.pdf($|\\?)/i.test(item.url)
        || (hay.includes('proquest') && hay.includes('full text'));
      if (!isFullText) continue;
      const key = item.url;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push({
        label: item.label || 'Full Text Link',
        url: item.url,
      });
    }

    return filtered;
  })()`);

  return Array.isArray(result) ? result as WosFullTextLink[] : [];
}

/**
 * Scrape full-text links AND body text from a WoS full-record page.
 * Used by record.ts which also needs the raw body text for metadata extraction.
 */
export async function scrapeWosFullTextWithBody(
  page: PageLike,
  url: string,
): Promise<{ bodyText: string; fullTextLinks: WosFullTextLink[] }> {
  await page.goto(url, { settleMs: 4000 });
  await page.wait(2);

  const result = await page.evaluate(`(async () => {
    const normalize = (text) => String(text || '')
      .replace(/\\u00a0/g, ' ')
      .replace(/\\s+/g, ' ')
      .trim();
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };

    const fullTextButton = Array.from(document.querySelectorAll('button'))
      .find((el) => isVisible(el) && /full text links/i.test(String(el.textContent || '')));
    if (fullTextButton) {
      fullTextButton.click();
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    const body = String(document.body.innerText || '').replace(/\\u00a0/g, ' ');

    const allLinks = Array.from(document.querySelectorAll('a'))
      .map((el) => ({
        label: normalize(el.textContent || el.getAttribute('aria-label') || ''),
        url: String(el.href || '').trim(),
      }))
      .filter((item) => item.url);

    const filtered = [];
    const seen = new Set();
    for (const item of allLinks) {
      const hay = (item.label + ' ' + item.url).toLowerCase();
      if (hay.includes('google scholar')) continue;
      if (hay.includes('journal citation reports')) continue;
      if (hay.includes('journal citation indicator')) continue;
      if (hay.includes('accessibility')) continue;
      if (hay.includes('/wos/pqdt/')) continue;
      const isFullText = hay.includes('context sensitive')
        || hay.includes('free full text')
        || hay.includes('view full text')
        || hay.includes('full text on proquest')
        || hay.includes('repository')
        || hay.includes('submitted article')
        || hay.includes('getftr')
        || /\\.pdf($|\\?)/i.test(item.url)
        || (hay.includes('proquest') && hay.includes('full text'));
      if (!isFullText) continue;
      const key = item.url;
      if (seen.has(key)) continue;
      seen.add(key);
      filtered.push({
        label: item.label || 'Full Text Link',
        url: item.url,
      });
    }

    return { bodyText: body, fullTextLinks: filtered };
  })()`);

  if (!result || typeof result !== 'object') {
    return { bodyText: '', fullTextLinks: [] };
  }

  const r = result as { bodyText?: string; fullTextLinks?: WosFullTextLink[]; metadata?: Record<string, string> };

  return {
    bodyText: r.bodyText ?? '',
    fullTextLinks: Array.isArray(r.fullTextLinks) ? r.fullTextLinks : [],
  };
}
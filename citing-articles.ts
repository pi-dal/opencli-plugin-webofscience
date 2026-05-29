import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from './src/lib/errors';
import {
  buildExactQuery,
  citingSummaryUrl,
  dismissCookieConsent,
  fullRecordUrl,
  normalizeDatabase,
  parseRecordIdentifier,
  smartSearchUrl,
  toProduct,
} from './src/lib/shared';

async function fillAndSubmit(
  page: { evaluate: (js: string) => Promise<any>; wait: (seconds: number) => Promise<any> },
  query: string,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(`(async () => {
        const query = ${JSON.stringify(query)};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        };
        const setNativeValue = (input, value) => {
          if (!input) return false;
          const proto = Object.getPrototypeOf(input);
          const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
            || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          descriptor?.set?.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const searchInput = document.querySelector('textarea#composeQuerySmartSearch, #search-option-0')
          || Array.from(document.querySelectorAll('textarea, input[type="text"]')).find(el => isVisible(el));
        if (!searchInput) throw new Error('Search input not found');
        setNativeValue(searchInput, query);
        await sleep(800);
        const searchBtn = document.querySelector('button[aria-label="Search"], button[type="submit"]')
          || Array.from(document.querySelectorAll('button')).find(el => isVisible(el)
            && (normalize(el.textContent) === 'search' || String(el.getAttribute('aria-label')).toLowerCase().includes('search')));
        if (searchBtn) { searchBtn.click(); return; }
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        await sleep(500);
        searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
      })()`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await page.wait(3);
    }
  }
  throw lastError;
}

async function waitForSummaryUrl(
  page: { evaluate: (js: string) => Promise<any>; wait: (seconds: number) => Promise<any> },
): Promise<{ href: string; text: string; qid: string }> {
  let state = { href: '', text: '' };
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = await page.evaluate(`(() => ({
      href: String(location.href || ''),
      text: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 6000),
    }))()`);
    state = { href: String(raw?.href ?? ''), text: String(raw?.text ?? '') };
    if (state.href.includes('/summary/') || /results from Web of Science/i.test(state.text)) {
      const qid = state.href.match(/\/summary\/([^/]+)/)?.[1] ?? '';
      return { ...state, qid };
    }
    await page.wait(1);
  }
  return { ...state, qid: '' };
}

cli({
  site: 'webofscience',
  name: 'citing-articles',
  description: 'List articles citing a Web of Science record. Requires an active WoS session (institutional login).',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  access: 'read',
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: 'Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046' },
    { name: 'database', required: false, help: 'Database to use. Defaults to woscc.', choices: ['woscc', 'alldb'] },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (max 50)' },
  ],
  defaultFormat: 'plain',
  columns: ['rank', 'title', 'authors', 'source', 'year', 'cited', 'url'],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id ?? '').trim();
    if (!rawId) throw new ArgumentError('Record identifier is required');

    const identifier = parseRecordIdentifier(rawId);
    if (!identifier) {
      throw new ArgumentError('Record identifier must be a Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046');
    }

    const database = normalizeDatabase(kwargs.database, identifier.database ?? 'woscc');
    const limit = Math.max(1, Math.min(50, Number(kwargs.limit ?? 10) || 10));

    // Step 1: Search for the record to extract its UT
    // Use Smart Search which parses fielded queries natively
    const searchQuery = buildExactQuery(identifier);
    await page.goto(smartSearchUrl(database), { settleMs: 4000 });
    await page.wait(2);
    await dismissCookieConsent(page);
    await fillAndSubmit(page, searchQuery);
    const { href, text, qid } = await waitForSummaryUrl(page);

    // Extract UT from the first result link
    const ut = await page.evaluate(`(() => {
      const link = document.querySelector('a[href*="/full-record/"]');
      if (!link) return '';
      const m = (link.getAttribute('href') || '').match(/full-record\\/(WOS:[A-Z0-9]+)/);
      return m?.[1] || '';
    })()`);

    if (!ut) {
      throw new EmptyResultError(
        'webofscience citing-articles',
        `Could not find the record on the search results page. Try using a Web of Science UT directly, or check that you have an active WoS institutional login session in Chrome.`,
      );
    }

    // Step 2: Navigate to the citing articles summary page
    await page.goto(citingSummaryUrl(database, ut), { settleMs: 8000 });
    await page.wait(5);

    // Step 3: Try to scrape citing articles from the DOM
    let rows = await page.evaluate(`(async () => {
      const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
      const results = [];
      const items = document.querySelectorAll('app-record, mat-expansion-panel, [role="listitem"], .record-item');
      for (const item of items) {
        const text = normalize(item.textContent);
        const link = item.querySelector('a[href*="/full-record/"]');
        const title = link ? normalize(link.textContent) : '';
        if (!title || title.length < 5) continue;
        const href = link.getAttribute('href') || '';
        const utMatch = href.match(/full-record\\/(WOS:[A-Z0-9]+)/);
        results.push({
          title,
          authors: normalize(item.querySelector('.author, [class*="author"]')?.textContent || ''),
          year: text.match(/\\b((?:19|20)\\d{2})\\b/)?.[1] || '',
          source: normalize(item.querySelector('.source, .journal, [class*="source"]')?.textContent || ''),
          cited: text.match(/(\\d+)\\s+Times\\s+Cited/i)?.[1] || text.match(/(\\d+)\\s+Citations?/i)?.[1] || '0',
          ut: utMatch?.[1] || '',
        });
      }
      if (results.length) return results;

      // Broader fallback: find all record links
      const links = Array.from(document.querySelectorAll('a[href*="/full-record/"]'));
      const seen = new Set();
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (seen.has(href)) continue;
        seen.add(href);
        const title = normalize(link.textContent);
        if (!title || title.length < 5) continue;
        const parent = link.closest('div, li, article');
        const parentText = parent ? normalize(parent.textContent) : title;
        const utMatch = href.match(/full-record\\/(WOS:[A-Z0-9]+)/);
        results.push({
          title,
          authors: '',
          year: parentText.match(/\\b((?:19|20)\\d{2})\\b/)?.[1] || '',
          source: '',
          cited: parentText.match(/(\\d+)\\s+Times\\s+Cited/i)?.[1] || parentText.match(/(\\d+)\\s+Citations?/i)?.[1] || '0',
          ut: utMatch?.[1] || '',
        });
      }
      return results;
    })()`);

    if (rows.length) {
      return (rows as Array<{ title: string; authors: string; source: string; year: string; cited: string; ut: string }>).slice(0, limit).map((item, index) => ({
        rank: index + 1,
        title: item.title,
        authors: item.authors,
        source: item.source,
        year: item.year,
        cited: item.cited,
        url: item.ut ? fullRecordUrl(database, item.ut) : '',
      }));
    }

    // Step 4: Fallback — try API from within browser context
    const sid = await page.evaluate(`(() => {
      try {
        for (const e of performance.getEntriesByType('resource')) {
          const s = new URL(e.name).searchParams.get('SID');
          if (s) return s;
        }
      } catch (_) {}
      return '';
    })()`);

    if (sid) {
      const records = await page.evaluate(`(async () => {
        const sid = ${JSON.stringify(sid)};
        const ut = ${JSON.stringify(ut)};
        const database = ${JSON.stringify(database)};
        const limit = ${JSON.stringify(limit)};
        const res = await fetch('/api/wosnx/core/runQuerySearch?SID=' + encodeURIComponent(sid), {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            qid: ut, product: ${JSON.stringify(toProduct(database))}, searchMode: 'citing_article',
            viewType: 'summary',
            retrieve: { first: limit, count: 0, citations: true },
          }),
        });
        const text = await res.text();
        const events = text.split('\\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        const records = [];
        for (const event of events) {
          const recs = event?.payload?.records || event?.payload?.data?.records || [];
          if (recs.length) records.push(...recs);
        }
        return records.map(r => ({
          title: r?.title?.item?.value || '',
          authors: String(r?.authors?.value || r?.author?.value || ''),
          year: String(r?.pub_info?.pubyear || ''),
          source: r?.title?.source?.value || '',
          cited: String(r?.citation_related?.counts?.[${JSON.stringify(toProduct(database))}] || '0'),
          ut: r?.ut || '',
        })).filter(r => r.title).slice(0, limit);
      })()`);

      if (records.length) {
        return (records as Array<{ title: string; authors: string; year: string; source: string; cited: string; ut: string }>).map((r, i) => ({ rank: i + 1, ...r, url: r.ut ? fullRecordUrl(database, r.ut) : '' }));
      }
    }

    throw new EmptyResultError(
      'webofscience citing-articles',
      'No citing articles found. This command requires an active WoS institutional login. Try opening https://webofscience.clarivate.cn in Chrome first.',
    );
  },
});
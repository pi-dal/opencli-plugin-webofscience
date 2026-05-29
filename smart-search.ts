import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from './src/lib/errors';
import {
  buildSearchPayload,
  clampLimit,
  dismissCookieConsent,
  extractRecords,
  firstTitle,
  formatAuthors,
  fullRecordUrl,
  normalizeDatabase,
  smartSearchUrl,
  toProduct,
} from './src/lib/shared';

async function fillSmartSearch(
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

async function waitForSummaryPage(
  page: { evaluate: (js: string) => Promise<any>; wait: (seconds: number) => Promise<any> },
): Promise<{ href: string; text: string; qid: string }> {
  let state = { href: '', text: '' };
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = await page.evaluate(`(() => ({
      href: String(location.href || ''),
      text: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 6000),
    }))()`);
    state = { href: String(raw?.href ?? ''), text: String(raw?.text ?? '') };
    if (state.href.includes('/summary/') || /results from Web of Science/i.test(state.text)) break;
    await page.wait(1);
  }
  const qid = state.href.match(/\/summary\/([^/]+)/)?.[1] ?? '';
  return { ...state, qid };
}

async function scrapeRecords(
  page: { evaluate: (js: string) => Promise<any> },
): Promise<Array<{ title: string; authors: string; year: string; source: string; cited: string; doi: string; ut: string }>> {
  return page.evaluate(`(() => {
    const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim();
    const results = [];
    const items = document.querySelectorAll('mat-expansion-panel, .search-results-item, [role="listitem"], app-record, .record-item');
    if (!items.length) {
      const links = Array.from(document.querySelectorAll('a[href*="/full-record/"]'));
      const seen = new Set();
      for (const link of links) {
        const href = link.getAttribute('href') || '';
        if (seen.has(href)) continue;
        seen.add(href);
        const title = normalize(link.textContent);
        if (!title || title.length < 5) continue;
        const card = link.closest('div, article, li') || link.parentElement;
        const text = normalize(card?.textContent || '');
        const doiMatch = text.match(/\\b(10\\.[0-9]{4,}[^\\s]*)/i);
        const utMatch = href.match(/full-record\\/(WOS:[A-Z0-9]+)/);
        const yearMatch = text.match(/\\b((?:19|20)\\d{2})\\b/);
        const citedMatch = text.match(/(\\d+)\\s+Citations?/i);
        results.push({
          title, authors: '', year: yearMatch?.[1] || '', source: '',
          cited: citedMatch?.[1] || '0', doi: doiMatch?.[1] || '', ut: utMatch?.[1] || '',
        });
      }
      return results;
    }
    for (const item of items) {
      const text = normalize(item.textContent);
      const titleEl = item.querySelector('a[href*="/full-record/"], h2, h3, .title, [class*="title"]');
      const title = titleEl ? normalize(titleEl.textContent) : '';
      if (!title) continue;
      results.push({
        title,
        authors: normalize(item.querySelector('.author, [class*="author"]')?.textContent || ''),
        year: normalize(item.querySelector('.year, .date, [class*="year"]')?.textContent || '').match(/\\b((?:19|20)\\d{2})\\b/)?.[1] || '',
        source: normalize(item.querySelector('.source, .journal, [class*="source"]')?.textContent || ''),
        cited: (text.match(/(\\d+)\\s+Times\\s+Cited/i)?.[1] || text.match(/(\\d+)\\s+Citations?/i)?.[1] || '0'),
        doi: text.match(/\\b(10\\.[0-9]{4,}[^\\s]*)/i)?.[1] || '',
        ut: item.querySelector('a[href*="/full-record/"]')?.getAttribute('href')?.match(/full-record\\/(WOS:[A-Z0-9]+)/)?.[1] || '',
      });
    }
    return results;
  })()`);
}

cli({
  site: 'webofscience',
  name: 'smart-search',
  description: 'Search Web of Science via the Smart Search page. Requires an active WoS session (institutional login).',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  access: 'read',
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Natural-language or fielded query, e.g. machine learning or TS=(machine learning)' },
    { name: 'database', required: false, help: 'Database to search. Defaults to woscc.', choices: ['woscc', 'alldb'] },
    { name: 'limit', type: 'int', default: 10, help: 'Max results (max 50)' },
  ],
  defaultFormat: 'plain',
  columns: ['rank', 'title', 'authors', 'source', 'year', 'cited', 'doi', 'url'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new ArgumentError('Search query is required');

    const database = normalizeDatabase(kwargs.database);
    const limit = clampLimit(kwargs.limit);

    await page.goto(smartSearchUrl(database), { settleMs: 4000 });
    await page.wait(2);
    await dismissCookieConsent(page);
    await fillSmartSearch(page, query);

    const { href, text, qid } = await waitForSummaryPage(page);

    // Try DOM scraping first
    let rows = (await scrapeRecords(page))
      .slice(0, limit)
      .map((item, index) => ({
        rank: index + 1,
        title: item.title,
        authors: item.authors,
        source: item.source,
        year: item.year,
        cited: item.cited,
        doi: item.doi,
        url: item.ut ? fullRecordUrl(database, item.ut) : '',
      }))
      .filter(r => r.title);

    // Fallback: try API from within browser context
    if (!rows.length && qid) {
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
        const payload = buildSearchPayload(query, limit, database);
        const events = await page.evaluate(`(async () => {
          const payload = ${JSON.stringify(payload)};
          const res = await fetch('/api/wosnx/core/runQuerySearch?SID=' + encodeURIComponent(${JSON.stringify(sid)}), {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          return res.json();
        })()`);
        const records = extractRecords(events);
        rows = records.slice(0, limit).map((record, index) => ({
          rank: index + 1,
          title: firstTitle(record, 'item'),
          authors: formatAuthors(record),
          year: record.pub_info?.pubyear ?? '',
          source: firstTitle(record, 'source'),
          cited: String(record.citation_related?.counts?.[toProduct(database)] ?? 0),
          doi: record.doi ?? '',
          url: record.ut ? fullRecordUrl(database, record.ut) : '',
        })).filter(r => r.title);
      }
    }

    if (!rows.length) {
      throw new EmptyResultError(
        'webofscience smart-search',
        'No results found. This command requires an active WoS institutional login session. Try opening https://webofscience.clarivate.cn in Chrome first.',
      );
    }

    return rows;
  },
});
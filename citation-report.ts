import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from './src/lib/errors';
import { basicSearchUrl, normalizeDatabase, toProduct } from './src/lib/shared';

async function submitSearch(
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

        const searchBtn = document.querySelector('button[aria-label="Search"], button.search, button[aria-label="Submit your question"]')
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
      if (attempt < 2) { await page.wait(3); }
    }
  }
  throw lastError;
}

cli({
  site: 'webofscience',
  name: 'citation-report',
  description: 'Get citation metrics (h-index, total citations, etc.) for a search query. Requires an active WoS session (institutional login).',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  access: 'read',
  browser: true,
  navigateBefore: false,
  defaultFormat: 'plain',
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query, e.g. machine learning' },
    { name: 'database', required: false, help: 'Database to search. Defaults to woscc.', choices: ['woscc', 'alldb'] },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new ArgumentError('Search query is required');

    const database = normalizeDatabase(kwargs.database);

    await page.goto(basicSearchUrl(database), { settleMs: 4000 });
    await page.wait(2);
    await submitSearch(page, query);

    // Wait for results page
    let pageState = { href: '', text: '' };
    for (let attempt = 0; attempt < 20; attempt++) {
      pageState = await page.evaluate(`(() => ({
        href: String(location.href || ''),
        text: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 4000),
      }))()`);
      if (pageState.href.includes('/summary/')) { break; }
      await page.wait(1);
    }

    // Extract qid from URL
    const href = pageState.href;
    const qidMatch = href.match(/\/summary\/([^/]+)/);
    const qid = qidMatch?.[1] ?? '';

    if (!qid) {
      throw new EmptyResultError(
        'webofscience citation-report',
        `Could not extract search ID from URL. Make sure you are signed in to Web of Science. URL: ${href}`,
      );
    }

    // Try to extract SID from page performance entries
    const sid = await page.evaluate(`(() => {
      try {
        const entries = performance.getEntriesByType('resource');
        for (const entry of entries) {
          const url = new URL(entry.name);
          const s = url.searchParams.get('SID');
          if (s) return s;
        }
      } catch (_) {}
      return '';
    })()`);

    // Try API approach if SID is available
    if (sid) {
      const metrics = await page.evaluate(`(async () => {
        const qid = ${JSON.stringify(qid)};
        const sid = ${JSON.stringify(sid)};

        const doFetch = async (url, body) => {
          const res = await fetch(url + '?SID=' + encodeURIComponent(sid), {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) return null;
          const text = await res.text();
          for (const line of text.split('\\n').filter(Boolean)) {
            try {
              const event = JSON.parse(line);
              const d = event?.payload || event;
              if (event?.key === 'searchInfo' && d?.citationReport) return d.citationReport;
              if (event?.key === 'citationReport') return d;
              if (d?.sumOfTimesCited !== undefined) return d;
            } catch (_) {}
          }
          return null;
        };

        let data = await doFetch('/api/wosnx/core/runQuerySearch', {
          qid, product: ${JSON.stringify(toProduct(database))}, searchMode: 'general_semantic',
          viewType: 'summary',
          retrieve: { first: 1, count: 0, citations: true, citationReport: true },
        });
        if (!data) {
          data = await doFetch('/api/wosnx/core/citationReport', {
            qid, product: ${JSON.stringify(toProduct(database))}, searchMode: 'general_semantic',
          });
        }
        if (!data) return null;
        return {
          total_publications: String(data.totalRecords ?? data.totalPublications ?? ''),
          sum_of_times_cited: String(data.sumOfTimesCited ?? ''),
          citing_articles: String(data.citingArticles ?? ''),
          average_per_item: String(data.averagePerItem ?? ''),
          h_index: String(data.hIndex ?? ''),
        };
      })()`);

      if (metrics && Object.values(metrics).some(v => v)) {
        return Object.entries(metrics).map(([field, value]) => ({ field, value }));
      }
    }

    // Fallback: navigate to citation report page and scrape DOM
    await page.goto(`https://webofscience.clarivate.cn/wos/${database}/citation-report/${qid}`, { settleMs: 10000 });
    await page.wait(6);
    const pageMetrics = await page.evaluate(`(() => {
      const bodyText = String(document.body.innerText || '').replace(/\\s+/g, ' ').trim();
      if (bodyText.includes('Sign In') && bodyText.length < 800) {
        return { _auth: 'WoS authentication required. Please sign in to Web of Science first.' };
      }
      const m = {};
      const patterns = {
        total_publications: /Total\\s+Publications?[\\s:]*([\\d,]+)/i,
        sum_of_times_cited: /Sum\\s+of\\s+Times\\s+Cited[\\s:]*([\\d,]+)/i,
        citing_articles: /Citing\\s+Articles?[\\s:]*([\\d,]+)/i,
        average_per_item: /Average\\s+(?:Citations?\\s+)?per\\s+(?:Item|Article)[\\s:]*([\\d.,]+)/i,
        h_index: /h\\s*[-–—]?\\s*index[\\s:]*([\\d.]+)/i,
      };
      for (const [key, p] of Object.entries(patterns)) {
        const match = bodyText.match(p);
        if (match) m[key] = match[1];
      }
      if (Object.values(m).some(v => v)) return m;
      if (bodyText.includes('too many results')) return { _limit: 'Query too broad (>50k results). Try a more specific query.' };
      return { _raw: bodyText.slice(0, 1000) };
    })()`);

    // Check for special messages
    if (pageMetrics?._auth) throw new EmptyResultError('webofscience citation-report', pageMetrics._auth);
    if (pageMetrics?._limit) throw new EmptyResultError('webofscience citation-report', pageMetrics._limit);

    if (pageMetrics && Object.values(pageMetrics).some(v => v)) {
      return Object.entries(pageMetrics).map(([field, value]) => ({ field, value }));
    }

    throw new EmptyResultError(
      'webofscience citation-report',
      'No citation metrics found. This command requires an active Web of Science session (institutional login). Try opening https://webofscience.clarivate.cn in Chrome first, then run again.',
    );
  },
});

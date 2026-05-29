// references.ts
import { cli, Strategy } from "@jackwener/opencli/registry";

// src/lib/errors.ts
var PluginError = class extends Error {
  constructor(message, hint) {
    super([message, hint].filter(Boolean).join(" "));
    this.name = new.target.name;
  }
};
var ArgumentError = class extends PluginError {
};
var EmptyResultError = class extends PluginError {
  constructor(command, hint) {
    super([`No results found for ${command}.`, hint].filter(Boolean).join(" "));
  }
};

// src/lib/shared.ts
function normalizeDatabase(value, fallback = "woscc") {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "woscc" || normalized === "alldb") return normalized;
  throw new ArgumentError(`Unsupported Web of Science database: ${String(value)}`);
}
function toProduct(database) {
  return database === "alldb" ? "ALLDB" : "WOSCC";
}
function smartSearchUrl(database) {
  return `https://webofscience.clarivate.cn/wos/${database}/smart-search`;
}
function fullRecordUrl(database, ut) {
  return `https://webofscience.clarivate.cn/wos/${database}/full-record/${ut}`;
}
function citedReferencesSummaryUrl(database, ut) {
  return `https://webofscience.clarivate.cn/wos/${database}/cited-references-summary/${ut}?from=${database}&type=colluid`;
}
async function dismissCookieConsent(page) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const clicked = await page.evaluate(`(() => {
      const btn = document.querySelector('#accept-recommended-btn-handler')
        || document.querySelector('#close-pc-btn-handler')
        || document.querySelector('.onetrust-close-btn-handler');
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    if (clicked) {
      await page.wait(1);
      const stillThere = await page.evaluate(`(() => {
        return !!document.querySelector('#onetrust-consent-sdk');
      })()`);
      if (!stillThere) return;
    }
    await page.wait(1);
  }
}
function parseRecordIdentifier(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (/doi\.org$/i.test(url.hostname)) {
      const doi = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      return doi ? { kind: "doi", value: doi } : null;
    }
    const match = url.pathname.match(/\/wos\/(woscc|alldb)\/full-record\/([^/?#]+)/i);
    if (match) {
      return {
        kind: "ut",
        value: decodeURIComponent(match[2]),
        database: normalizeDatabase(match[1])
      };
    }
  } catch {
  }
  if (/^WOS:[A-Z0-9]+$/i.test(trimmed)) {
    return { kind: "ut", value: trimmed.toUpperCase() };
  }
  if (/^10\.\d{4,9}\/\S+$/i.test(trimmed)) {
    return { kind: "doi", value: trimmed };
  }
  return null;
}
function buildExactQuery(identifier) {
  return identifier.kind === "ut" ? `UT=(${identifier.value})` : `DO=(${identifier.value})`;
}

// references.ts
async function fillAndSubmit(page, query) {
  let lastError;
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
async function waitForSummaryUrl(page) {
  let state = { href: "", text: "" };
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = await page.evaluate(`(() => ({
      href: String(location.href || ''),
      text: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 6000),
    }))()`);
    state = { href: String(raw?.href ?? ""), text: String(raw?.text ?? "") };
    if (state.href.includes("/summary/") || /results from Web of Science/i.test(state.text)) {
      const qid = state.href.match(/\/summary\/([^/]+)/)?.[1] ?? "";
      return { ...state, qid };
    }
    await page.wait(1);
  }
  return { ...state, qid: "" };
}
cli({
  site: "webofscience",
  name: "references",
  description: "List cited references for a Web of Science record. Requires an active WoS session (institutional login).",
  domain: "webofscience.clarivate.cn",
  strategy: Strategy.UI,
  access: "read",
  browser: true,
  navigateBefore: false,
  args: [
    { name: "id", positional: true, required: true, help: "Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046" },
    { name: "database", required: false, help: "Database to use. Defaults to woscc.", choices: ["woscc", "alldb"] },
    { name: "limit", type: "int", default: 10, help: "Max results (max 50)" }
  ],
  defaultFormat: "plain",
  columns: ["rank", "title", "authors", "source", "year", "cited", "url"],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id ?? "").trim();
    if (!rawId) throw new ArgumentError("Record identifier is required");
    const identifier = parseRecordIdentifier(rawId);
    if (!identifier) {
      throw new ArgumentError("Record identifier must be a Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046");
    }
    const database = normalizeDatabase(kwargs.database, identifier.database ?? "woscc");
    const limit = Math.max(1, Math.min(50, Number(kwargs.limit ?? 10) || 10));
    const searchQuery = buildExactQuery(identifier);
    await page.goto(smartSearchUrl(database), { settleMs: 4e3 });
    await page.wait(2);
    await dismissCookieConsent(page);
    await fillAndSubmit(page, searchQuery);
    const { href, text, qid } = await waitForSummaryUrl(page);
    const ut = await page.evaluate(`(() => {
      const link = document.querySelector('a[href*="/full-record/"]');
      if (!link) return '';
      const m = (link.getAttribute('href') || '').match(/full-record\\/(WOS:[A-Z0-9]+)/);
      return m?.[1] || '';
    })()`);
    if (!ut) {
      throw new EmptyResultError(
        "webofscience references",
        `Could not find the record on the search results page. Try using a Web of Science UT directly, or check that you have an active WoS institutional login session in Chrome.`
      );
    }
    await page.goto(citedReferencesSummaryUrl(database, ut), { settleMs: 8e3 });
    await page.wait(5);
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
      return rows.slice(0, limit).map((item, index) => ({
        rank: index + 1,
        title: item.title,
        authors: item.authors,
        source: item.source,
        year: item.year,
        cited: item.cited,
        url: item.ut ? fullRecordUrl(database, item.ut) : ""
      }));
    }
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
            qid: ut, product: ${JSON.stringify(toProduct(database))}, searchMode: 'cited_references',
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
          title: r?.title?.item?.value || r?.title?.source?.value || '',
          authors: String(r?.authors?.value || r?.author?.value || ''),
          year: String(r?.pub_info?.pubyear || ''),
          source: r?.title?.source?.value || '',
          cited: String(r?.citation_related?.counts?.[${JSON.stringify(toProduct(database))}] || '0'),
          ut: r?.ut || '',
        })).filter(r => r.title).slice(0, limit);
      })()`);
      if (records.length) {
        return records.map((r, i) => ({ rank: i + 1, ...r, url: r.ut ? fullRecordUrl(database, r.ut) : "" }));
      }
    }
    throw new EmptyResultError(
      "webofscience references",
      "No cited references found. This command requires an active WoS institutional login. Try opening https://webofscience.clarivate.cn in Chrome first."
    );
  }
});

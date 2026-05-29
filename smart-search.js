// smart-search.ts
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
var CommandExecutionError = class extends PluginError {
};

// src/lib/shared.ts
var MAX_LIMIT = 50;
function clampLimit(value) {
  const parsed = Number(value ?? 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(Math.floor(parsed), MAX_LIMIT);
}
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
function buildSearchPayload(query, limit, database, rowText = `TS=(${query})`, analyzeFacet) {
  const product = toProduct(database);
  return {
    product,
    searchMode: "general_semantic",
    viewType: "search",
    serviceMode: "summary",
    search: {
      mode: "general_semantic",
      database: product,
      disableEdit: false,
      query: [{ rowText }],
      display: {
        key: "nlp",
        params: { input: query }
      },
      blending: "blended",
      count: 100
    },
    retrieve: {
      count: limit,
      history: true,
      jcr: true,
      sort: "relevance",
      analyzes: analyzeFacet ? [analyzeFacet] : [
        "TP.Value.6",
        "REVIEW.Value.6",
        "EARLY ACCESS.Value.6",
        "OA.Value.6",
        "DR.Value.6",
        "ECR.Value.6",
        "PY.Field_D.6",
        "FPY.Field_D.6",
        "DT.Value.6",
        "AU.Value.6",
        "DX2NG.Value.6",
        "PEERREVIEW.Value.6",
        "STK.Value.10"
      ],
      locale: "en"
    },
    eventMode: null
  };
}
function formatAuthors(record) {
  const authors = record.names?.author?.en ?? [];
  return authors.map((author) => {
    if (!author) return "";
    if (author.wos_standard) return author.wos_standard;
    const last = author.last_name?.trim();
    const first = author.first_name?.trim();
    if (last && first) return `${last}, ${first}`;
    return last || first || "";
  }).filter(Boolean).join("; ");
}
function firstTitle(record, branch) {
  return record.titles?.[branch]?.en?.[0]?.title ?? "";
}
function extractRecords(events) {
  if (!Array.isArray(events)) return [];
  const eventList = events;
  const errors = eventList.filter((event) => event?.key === "error").flatMap((event) => Array.isArray(event.payload) ? event.payload : []);
  if (errors.includes("Server.passiveVerificationRequired")) {
    throw new CommandExecutionError(
      "Web of Science requested passive verification before search results could be fetched",
      "Try again in Chrome after the verification completes."
    );
  }
  if (errors.includes("Server.sessionNotFound")) {
    throw new CommandExecutionError(
      "Web of Science search session expired before results could be fetched",
      "Try running the command again."
    );
  }
  const recordsPayload = eventList.find((event) => event?.key === "records")?.payload ?? {};
  return Object.values(recordsPayload);
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

// smart-search.ts
async function fillSmartSearch(page, query) {
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
async function waitForSummaryPage(page) {
  let state = { href: "", text: "" };
  for (let attempt = 0; attempt < 20; attempt++) {
    const raw = await page.evaluate(`(() => ({
      href: String(location.href || ''),
      text: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 6000),
    }))()`);
    state = { href: String(raw?.href ?? ""), text: String(raw?.text ?? "") };
    if (state.href.includes("/summary/") || /results from Web of Science/i.test(state.text)) break;
    await page.wait(1);
  }
  const qid = state.href.match(/\/summary\/([^/]+)/)?.[1] ?? "";
  return { ...state, qid };
}
async function scrapeRecords(page) {
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
  site: "webofscience",
  name: "smart-search",
  description: "Search Web of Science via the Smart Search page. Requires an active WoS session (institutional login).",
  domain: "webofscience.clarivate.cn",
  strategy: Strategy.UI,
  access: "read",
  browser: true,
  navigateBefore: false,
  args: [
    { name: "query", positional: true, required: true, help: "Natural-language or fielded query, e.g. machine learning or TS=(machine learning)" },
    { name: "database", required: false, help: "Database to search. Defaults to woscc.", choices: ["woscc", "alldb"] },
    { name: "limit", type: "int", default: 10, help: "Max results (max 50)" }
  ],
  defaultFormat: "plain",
  columns: ["rank", "title", "authors", "source", "year", "cited", "doi", "url"],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? "").trim();
    if (!query) throw new ArgumentError("Search query is required");
    const database = normalizeDatabase(kwargs.database);
    const limit = clampLimit(kwargs.limit);
    await page.goto(smartSearchUrl(database), { settleMs: 4e3 });
    await page.wait(2);
    await dismissCookieConsent(page);
    await fillSmartSearch(page, query);
    const { href, text, qid } = await waitForSummaryPage(page);
    let rows = (await scrapeRecords(page)).slice(0, limit).map((item, index) => ({
      rank: index + 1,
      title: item.title,
      authors: item.authors,
      source: item.source,
      year: item.year,
      cited: item.cited,
      doi: item.doi,
      url: item.ut ? fullRecordUrl(database, item.ut) : ""
    })).filter((r) => r.title);
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
          title: firstTitle(record, "item"),
          authors: formatAuthors(record),
          year: record.pub_info?.pubyear ?? "",
          source: firstTitle(record, "source"),
          cited: String(record.citation_related?.counts?.[toProduct(database)] ?? 0),
          doi: record.doi ?? "",
          url: record.ut ? fullRecordUrl(database, record.ut) : ""
        })).filter((r) => r.title);
      }
    }
    if (!rows.length) {
      throw new EmptyResultError(
        "webofscience smart-search",
        "No results found. This command requires an active WoS institutional login session. Try opening https://webofscience.clarivate.cn in Chrome first."
      );
    }
    return rows;
  }
});

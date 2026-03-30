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
var SEARCH_INPUT_SELECTOR = "#composeQuerySmartSearch";
var SUBMIT_BUTTON_SELECTOR = "button[aria-label='Submit your question']";
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
function buildSearchPayload(query, limit, database, rowText = `TS=(${query})`) {
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
      analyzes: [
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
function extractSessionState(page) {
  return page.evaluate(`(() => {
    const entry = performance.getEntriesByType('resource')
      .find(e => String(e.name).includes('/api/wosnx/core/runQuerySearch?SID='));
    const sid = entry ? new URL(entry.name).searchParams.get('SID') : null;
    return { sid, href: location.href };
  })()`);
}
async function ensureSearchSession(page, database, query) {
  return ensureSearchSessionAtUrl(page, smartSearchUrl(database), query, SEARCH_INPUT_SELECTOR, { requireSummaryPage: true });
}
async function ensureSearchSessionAtUrl(page, url, query, preferredSelector, options = {}) {
  const requireSummaryPage = options.requireSummaryPage === true;
  const isSummaryHref = (href) => {
    return typeof href === "string" && /\/summary\//.test(href);
  };
  const isReady = (session2) => {
    return Boolean(session2?.sid) && (!requireSummaryPage || isSummaryHref(session2?.href));
  };
  const waitForReadySession = async (initialSession) => {
    let session2 = initialSession ?? await extractSessionState(page);
    for (let attempt = 0; attempt < 3 && !isReady(session2); attempt++) {
      await page.wait(4);
      session2 = await extractSessionState(page);
    }
    return session2;
  };
  await page.goto(url, { settleMs: 4e3 });
  await page.wait(2);
  await typeIntoSearch(page, query, preferredSelector);
  await page.wait(1);
  await submitSearch(page);
  await page.wait(6);
  let session = await waitForReadySession();
  if (!isReady(session)) {
    await submitSearch(page);
    await page.wait(10);
    session = await waitForReadySession();
  }
  if (!isReady(session)) {
    if (requireSummaryPage && session?.sid) {
      throw new CommandExecutionError(
        "Web of Science requested passive verification before search results could be fetched",
        "Try again in Chrome after the verification completes."
      );
    }
    throw new CommandExecutionError(
      "Web of Science search session was not established",
      "The page may still be waiting for passive verification. Try again in Chrome."
    );
  }
  return session.sid;
}
async function submitSearch(page) {
  try {
    await page.click(SUBMIT_BUTTON_SELECTOR);
    return;
  } catch {
  }
  const submitRef = await findVisibleSubmitButtonRef(page);
  if (submitRef) {
    try {
      await page.click(String(submitRef));
      return;
    } catch {
    }
  }
  await page.pressKey("Enter");
}
async function findVisibleSubmitButtonRef(page) {
  const ref = await page.evaluate(`(() => {
    const submitRef = 'opencli-search-submit';
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    for (const node of document.querySelectorAll('[data-ref="opencli-search-submit"]')) {
      node.removeAttribute('data-ref');
    }
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'))
      .filter((el) => !el.disabled && isVisible(el));
    const target = buttons.find((el) => {
      const text = String(el.textContent || el.getAttribute('value') || '').trim();
      const type = String(el.getAttribute('type') || '').toLowerCase();
      const ariaLabel = String(el.getAttribute('aria-label') || '').trim();
      const hay = (text + ' ' + ariaLabel).toLowerCase();
      if (hay.includes('history')) return false;
      if (hay.includes('saved searches')) return false;
      if (hay.includes('search history')) return false;
      return type === 'submit'
        || /^search\b/.test(hay)
        || hay.includes('submit your question');
    });
    if (!target) return null;
    target.setAttribute('data-ref', submitRef);
    return submitRef;
  })()`);
  return typeof ref === "string" ? ref : null;
}
async function typeIntoSearch(page, query, preferredSelector) {
  const discoveredRef = "opencli-search-input";
  if (preferredSelector) {
    try {
      await page.typeText(preferredSelector, query);
      return;
    } catch {
    }
  }
  let selector = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    selector = await page.evaluate(`(() => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 0
        && rect.height > 0;
    };
    for (const node of document.querySelectorAll('[data-ref="opencli-search-input"]')) {
      node.removeAttribute('data-ref');
    }
    const candidates = Array.from(document.querySelectorAll('input, textarea'))
      .filter((el) => !el.disabled && !el.readOnly && isVisible(el))
      .sort((a, b) => {
        const aScore = (a.matches('input[type="search"], input[type="text"], textarea') ? 10 : 0) + (a.placeholder ? 2 : 0);
        const bScore = (b.matches('input[type="search"], input[type="text"], textarea') ? 10 : 0) + (b.placeholder ? 2 : 0);
        return bScore - aScore;
      });
    const target = candidates[0];
    if (!target) return null;
    target.setAttribute('data-ref', ${JSON.stringify(discoveredRef)});
    return ${JSON.stringify(discoveredRef)};
  })()`);
    if (selector) break;
    if (attempt < 2) {
      await page.wait(2);
    }
  }
  if (!selector) {
    throw new CommandExecutionError(
      "Web of Science search input was not found",
      "The search page may not have finished loading. Try again in Chrome."
    );
  }
  try {
    await page.typeText(String(selector), query);
  } catch {
    await page.wait(4);
    await page.typeText(String(selector), query);
  }
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

// smart-search.ts
cli({
  site: "webofscience",
  name: "smart-search",
  description: "Search Web of Science via the Smart Search page",
  domain: "webofscience.clarivate.cn",
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: "query", positional: true, required: true, help: "Natural-language or fielded query, e.g. machine learning or TS=(machine learning)" },
    { name: "database", required: false, help: "Database to search. Defaults to woscc.", choices: ["woscc", "alldb"] },
    { name: "limit", type: "int", default: 10, help: "Max results (max 50)" }
  ],
  columns: ["rank", "title", "authors", "year", "source", "citations", "doi", "url"],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? "").trim();
    if (!query) {
      throw new ArgumentError("Search query is required");
    }
    const database = normalizeDatabase(kwargs.database);
    const limit = clampLimit(kwargs.limit);
    const sid = await ensureSearchSession(page, database, query);
    const payload = buildSearchPayload(query, limit, database);
    const events = await page.evaluate(`(async () => {
      const payload = ${JSON.stringify(payload)};
      const res = await fetch('/api/wosnx/core/runQuerySearch?SID=' + encodeURIComponent(${JSON.stringify(sid)}), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return res.json();
    })()`);
    const records = extractRecords(events).slice(0, limit).map((record, index) => ({
      rank: index + 1,
      title: firstTitle(record, "item"),
      authors: formatAuthors(record),
      year: record.pub_info?.pubyear ?? "",
      source: firstTitle(record, "source"),
      citations: record.citation_related?.counts?.WOSCC ?? 0,
      doi: record.doi ?? "",
      url: record.ut ? fullRecordUrl(database, record.ut) : ""
    })).filter((record) => record.title);
    if (!records.length) {
      throw new EmptyResultError("webofscience smart-search", "Try a different keyword or verify your Web of Science access in Chrome");
    }
    return records;
  }
});
export {
  smartSearchUrl
};

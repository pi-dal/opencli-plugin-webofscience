// full-text.ts
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
var UpstreamServiceError = class extends PluginError {
  constructor(service, status, hint) {
    super(`Upstream service ${service} returned status ${status}.`, hint);
  }
};

// src/lib/shared.ts
function normalizeDatabase(value, fallback = "woscc") {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "woscc" || normalized === "alldb") return normalized;
  throw new ArgumentError(`Unsupported Web of Science database: ${String(value)}`);
}
function fullRecordUrl(database, ut) {
  return `https://webofscience.clarivate.cn/wos/${database}/full-record/${ut}`;
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

// src/lib/wos-full-text.ts
async function scrapeWosFullTextLinks(page, url) {
  await page.goto(url, { settleMs: 5e3 });
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
  return Array.isArray(result) ? result : [];
}

// full-text.ts
var OPENALEX_API = "https://api.openalex.org";
async function fetchOpenAlexWork(doi) {
  const url = `${OPENALEX_API}/works/doi:${encodeURIComponent(doi)}?mailto=opencli-plugin-webofscience@users.noreply.github.com`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1e4);
  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" }
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new UpstreamServiceError("OpenAlex API", "timeout", "The request timed out after 10s.");
    }
    throw new UpstreamServiceError("OpenAlex API", "network-error", String(error));
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 429) {
    throw new UpstreamServiceError("OpenAlex API", 429, "Rate limited. Try again later.");
  }
  if (res.status >= 500) {
    throw new UpstreamServiceError("OpenAlex API", res.status, "OpenAlex API returned a server error.");
  }
  if (!res.ok) return null;
  const data = await res.json();
  return data;
}
function isPdfUrl(url) {
  try {
    const parsed = new URL(url);
    return /\.pdf$/i.test(parsed.pathname);
  } catch {
    return url.toLowerCase().includes(".pdf");
  }
}
function buildFullTextResult(params) {
  const { openalexWork, wosLinks, wosAvailable } = params;
  const oaUrl = openalexWork?.open_access?.oa_url || "";
  const hasOpenalex = Boolean(oaUrl);
  const hasWos = wosLinks.length > 0;
  let source = "none";
  if (hasOpenalex && hasWos) source = "openalex";
  else if (hasOpenalex) source = "openalex";
  else if (hasWos) source = "wos";
  let accessType = "unknown";
  if (hasOpenalex) accessType = "open_access";
  else if (hasWos && wosAvailable) accessType = "institutional";
  const bestUrl = oaUrl || wosLinks[0]?.url || "";
  let bestPdfUrl = "";
  if (oaUrl && isPdfUrl(oaUrl)) bestPdfUrl = oaUrl;
  if (!bestPdfUrl) {
    const pdfLink = wosLinks.find((link) => isPdfUrl(link.url));
    if (pdfLink) bestPdfUrl = pdfLink.url;
  }
  return {
    best_url: bestUrl,
    best_pdf_url: bestPdfUrl,
    open_access_url: oaUrl,
    wos_full_text_urls: wosLinks.map((l) => l.url),
    wos_full_text_labels: wosLinks.map((l) => l.label),
    source,
    access_type: accessType
  };
}
cli({
  site: "webofscience",
  name: "full-text",
  description: "Resolve the best available full-text entry URL for a Web of Science record. Combines OpenAlex OA data (for DOI-based lookups) with WoS institutional full-text links.",
  domain: "webofscience.clarivate.cn",
  strategy: Strategy.UI,
  access: "read",
  browser: true,
  navigateBefore: false,
  args: [
    { name: "id", positional: true, required: true, help: "Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046" },
    { name: "database", required: false, help: "Database to use. Defaults to the database in the identifier URL, otherwise woscc.", choices: ["woscc", "alldb"] }
  ],
  defaultFormat: "json",
  columns: ["best_url", "best_pdf_url", "open_access_url", "wos_full_text_urls", "source", "access_type"],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id ?? "").trim();
    if (!rawId) throw new ArgumentError("Record identifier is required");
    const identifier = parseRecordIdentifier(rawId);
    if (!identifier) {
      throw new ArgumentError("Record identifier must be a Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046");
    }
    const database = normalizeDatabase(kwargs.database, identifier.database ?? "woscc");
    const doi = identifier.kind === "doi" ? identifier.value : "";
    const ut = identifier.kind === "ut" ? identifier.value : "";
    let openalexWork = null;
    let openalexError = null;
    if (doi) {
      try {
        openalexWork = await fetchOpenAlexWork(doi);
      } catch (error) {
        openalexError = error;
      }
    }
    let wosLinks = [];
    let wosAvailable = false;
    if (ut) {
      try {
        const recordUrl = fullRecordUrl(database, ut);
        wosLinks = await scrapeWosFullTextLinks(page, recordUrl);
        wosAvailable = true;
      } catch {
      }
    }
    const result = buildFullTextResult({ openalexWork, wosLinks, wosAvailable });
    if (result.best_url) {
      return result;
    }
    if (openalexError) {
      throw openalexError;
    }
    throw new EmptyResultError(
      "webofscience full-text",
      "No full-text entry URL found. The record may not have an open-access version, or your WoS session may not have access."
    );
  }
});

// analyze-results.ts
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
function normalizeDatabase(value, fallback = "woscc") {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "woscc" || normalized === "alldb") return normalized;
  throw new ArgumentError(`Unsupported Web of Science database: ${String(value)}`);
}
function basicSearchUrl(database) {
  return `https://webofscience.clarivate.cn/wos/${database}/basic-search`;
}

// analyze-results.ts
var FACET_LABELS = {
  AU: "Authors",
  OG: "Affiliations",
  CU: "Countries/Regions",
  PY: "Publication Years",
  WC: "Web of Science Categories",
  DT: "Document Types",
  SO: "Source Titles",
  FO: "Funding Agencies"
};
var FACET_CHOICES = Object.keys(FACET_LABELS);
function normalizeFacet(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) throw new ArgumentError("Facet is required (--by)");
  const match = FACET_CHOICES.find((f) => f.toLowerCase() === raw);
  if (match) return match;
  const byLabel = FACET_CHOICES.find((f) => FACET_LABELS[f].toLowerCase().includes(raw));
  if (byLabel) return byLabel;
  throw new ArgumentError(
    `Unsupported facet: ${String(value)}. Choose from: ${FACET_CHOICES.join(", ")}`
  );
}
async function submitSearch(page, query) {
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

        // Find search input
        const searchInput = document.querySelector('textarea#composeQuerySmartSearch, #search-option-0')
          || Array.from(document.querySelectorAll('textarea, input[type="text"]')).find(el => isVisible(el));
        if (!searchInput) throw new Error('Search input not found');

        setNativeValue(searchInput, query);
        await sleep(800);

        // Click search button
        const searchBtn = document.querySelector('button[aria-label="Search"], button.search, button[aria-label="Submit your question"]')
          || Array.from(document.querySelectorAll('button')).find(el => isVisible(el)
            && (normalize(el.textContent) === 'search' || String(el.getAttribute('aria-label')).toLowerCase().includes('search')));
        if (searchBtn) { searchBtn.click(); return 'click'; }

        // Fallback: Enter key
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        await sleep(500);
        searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        return 'enter';
      })()`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await page.wait(3);
      }
    }
  }
  throw lastError;
}
async function waitForSearchResults(page) {
  let state = { href: "", text: "" };
  for (let attempt = 0; attempt < 20; attempt++) {
    state = await page.evaluate(`(() => ({
      href: String(location.href || ''),
      text: String(document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 6000),
    }))()`);
    if (new RegExp("/summary/").test(state.href) || /Search results/i.test(state.text) || /results from Web of Science/i.test(state.text)) {
      return state;
    }
    await page.wait(1);
  }
  return state;
}
cli({
  site: "webofscience",
  name: "analyze-results",
  description: "Analyze search results by facet distribution (authors, years, categories, etc.)",
  domain: "webofscience.clarivate.cn",
  strategy: Strategy.UI,
  access: "read",
  browser: true,
  navigateBefore: false,
  defaultFormat: "plain",
  args: [
    { name: "query", positional: true, required: true, help: "Search query, e.g. machine learning" },
    { name: "by", required: true, help: "Facet to analyze by", choices: FACET_CHOICES },
    { name: "database", required: false, help: "Database to search. Defaults to woscc.", choices: ["woscc", "alldb"] },
    { name: "limit", type: "int", default: 20, help: "Max facet values (max 50)" }
  ],
  columns: ["rank", "value", "count"],
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? "").trim();
    if (!query) throw new ArgumentError("Search query is required");
    const facet = normalizeFacet(kwargs.by);
    const facetLabel = FACET_LABELS[facet];
    const database = normalizeDatabase(kwargs.database);
    const limit = Math.max(1, Math.min(50, Number(kwargs.limit ?? 20) || 20));
    await page.goto(basicSearchUrl(database), { settleMs: 4e3 });
    await page.wait(2);
    await submitSearch(page, query);
    const landing = await waitForSearchResults(page);
    if (!new RegExp("/summary/").test(landing.href) && !/Search results/i.test(landing.text)) {
      throw new CommandExecutionError(
        "Web of Science search did not reach results page",
        "The page may still be waiting for passive verification. Try again in Chrome."
      );
    }
    const facetData = await page.evaluate(`(async () => {
      const targetLabel = ${JSON.stringify(facetLabel)};
      const normalize = (text) => String(text || '').replace(/\\s+/g, ' ').trim();

      // Find facet section by heading text
      const headings = Array.from(document.querySelectorAll('h3, h4, h5, .refine-header, .facet-title, mat-panel-title, [class*="title"]'));
      const targetHeading = headings.find(h => normalize(h.textContent).toLowerCase() === targetLabel.toLowerCase()
        || normalize(h.textContent).toLowerCase().includes(targetLabel.toLowerCase()));
      let section = targetHeading?.closest('mat-expansion-panel, .refine-section, .refine-panel, [class*="section"], div') || null;

      if (!section) {
        // Try finding by any label containing the facet name
        const allLabels = Array.from(document.querySelectorAll('.facet-label, .refine-label, span, label'));
        const match = allLabels.find(el => normalize(el.textContent).toLowerCase() === targetLabel.toLowerCase());
        if (match) {
          const clickable = match.closest('mat-expansion-panel-header, [role="heading"], button, .panel-header') || match;
          clickable.click();
          await new Promise(r => setTimeout(r, 600));
          section = match.closest('mat-expansion-panel, .refine-section, div[class]');
        }
      }

      if (section) {
        const items = Array.from(section.querySelectorAll('.facet-item, mat-checkbox, .mat-mdc-checkbox, [role="option"], li, .filter-item'));
        if (items.length > 0) {
          return items.map(el => {
            const labelEl = el.querySelector('.mat-mdc-checkbox-label, .facet-label-text, .item-label, span:not([class*="mat-ripple"])') || el;
            const countEl = el.querySelector('.facet-count, .count, .item-count, [class*="count"]');
            const fullText = normalize(labelEl.textContent);
            const countMatch = (countEl?.textContent || fullText).match(/([\\d,]+)$/);
            const count = countMatch ? parseInt(countMatch[1].replace(/[,\\s]/g, ''), 10) : 0;
            const value = fullText.replace(/[\\d,]+$/, '').trim();
            return { value: value || fullText, count };
          }).filter(item => item.value && item.value.length > 0);
        }
      }

      // Fallback: parse raw text for facet pattern
      const bodyText = String(document.body.innerText || '');
      const idx = bodyText.toLowerCase().indexOf(targetLabel.toLowerCase());
      if (idx >= 0) {
        const chunk = bodyText.slice(idx + targetLabel.length, idx + targetLabel.length + 800);
        const lines = chunk.split('\\n').map(l => l.trim()).filter(Boolean);
        const data = [];
        for (const line of lines) {
          if (/^(Refine results|Search results|Show more|Show less|Filter)/i.test(line)) continue;
          if (/^[A-Z]{2,5}$/.test(line)) continue;
          const m = line.match(/^(.+?)\\s+(\\d[d,]*)$/);
          if (m) data.push({ value: m[1].trim(), count: parseInt(m[2].replace(/[,\\s]/g, ''), 10) });
          else if (data.length > 0) break;
        }
        if (data.length > 0) return data;
      }

      return [];
    })()`);
    if (!Array.isArray(facetData) || !facetData.length) {
      throw new EmptyResultError(
        "webofscience analyze-results",
        `No ${facetLabel.toLowerCase()} data found on the results page. The facet sidebar may not be loaded. Try a different query or verify WoS access.`
      );
    }
    return facetData.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      value: item.value,
      count: item.count
    }));
  }
});

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from './src/lib/errors';
import {
  fullRecordUrl,
  normalizeDatabase,
  parseRecordIdentifier,
  type WosDatabase,
} from './src/lib/shared';

type FullTextSource = 'openalex' | 'wos' | 'combined' | 'none';
type AccessType = 'open_access' | 'institutional' | 'unknown';

type FullTextResult = {
  best_url: string;
  best_pdf_url: string;
  open_access_url: string;
  wos_full_text_urls: string[];
  wos_full_text_labels: string[];
  source: FullTextSource;
  access_type: AccessType;
};

const OPENALEX_API = 'https://api.openalex.org';

interface OpenAlexWork {
  open_access?: {
    is_oa?: boolean;
    oa_url?: string | null;
  };
  doi?: string;
}

async function fetchOpenAlexWork(doi: string): Promise<OpenAlexWork | null> {
  try {
    const url = `${OPENALEX_API}/works/doi:${encodeURIComponent(doi)}?mailto=opencli-plugin-webofscience@users.noreply.github.com`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data as OpenAlexWork;
  } catch {
    return null;
  }
}

function isPdfUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return /\.pdf$/i.test(parsed.pathname);
  } catch {
    return url.toLowerCase().includes('.pdf');
  }
}

function buildFullTextResult(params: {
  openalexWork: OpenAlexWork | null;
  wosLinks: Array<{ label: string; url: string }>;
  wosAvailable: boolean;
}): FullTextResult {
  const { openalexWork, wosLinks, wosAvailable } = params;
  const oaUrl = openalexWork?.open_access?.oa_url || '';
  const hasOpenalex = Boolean(oaUrl);
  const hasWos = wosLinks.length > 0;

  // Determine source
  let source: FullTextSource = 'none';
  if (hasOpenalex && hasWos) source = 'combined';
  else if (hasOpenalex) source = 'openalex';
  else if (hasWos) source = 'wos';

  // Determine access_type
  let accessType: AccessType = 'unknown';
  if (hasOpenalex) accessType = 'open_access';
  else if (hasWos && wosAvailable) accessType = 'institutional';

  // best_url: prefer OpenAlex OA URL (most stable for agents)
  const bestUrl = oaUrl || wosLinks[0]?.url || '';

  // best_pdf_url: only when URL is a genuine .pdf
  let bestPdfUrl = '';
  if (oaUrl && isPdfUrl(oaUrl)) bestPdfUrl = oaUrl;
  if (!bestPdfUrl) {
    const pdfLink = wosLinks.find(link => isPdfUrl(link.url));
    if (pdfLink) bestPdfUrl = pdfLink.url;
  }

  return {
    best_url: bestUrl,
    best_pdf_url: bestPdfUrl,
    open_access_url: oaUrl,
    wos_full_text_urls: wosLinks.map(l => l.url),
    wos_full_text_labels: wosLinks.map(l => l.label),
    source,
    access_type: accessType,
  };
}

async function scrapeWosFullTextLinks(
  page: {
    goto: (url: string, options?: Record<string, unknown>) => Promise<any>;
    wait: (seconds: number) => Promise<any>;
    evaluate: (js: string) => Promise<any>;
  },
  url: string,
): Promise<Array<{ label: string; url: string }>> {
  await page.goto(url, { settleMs: 5000 });
  await page.wait(3);

  const links = await page.evaluate(`(async () => {
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

    // Click "Full Text Links" button if present to expand the section
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

  return Array.isArray(links) ? links : [];
}

cli({
  site: 'webofscience',
  name: 'full-text',
  description: 'Resolve the best available full-text entry URL for a Web of Science record. Combines OpenAlex OA data (for DOI-based lookups) with WoS institutional full-text links.',
  domain: 'webofscience.clarivate.cn',
  strategy: Strategy.UI,
  access: 'read',
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'id', positional: true, required: true, help: 'Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046' },
    { name: 'database', required: false, help: 'Database to use. Defaults to the database in the identifier URL, otherwise woscc.', choices: ['woscc', 'alldb'] },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const rawId = String(kwargs.id ?? '').trim();
    if (!rawId) throw new ArgumentError('Record identifier is required');

    const identifier = parseRecordIdentifier(rawId);
    if (!identifier) {
      throw new ArgumentError('Record identifier must be a Web of Science UT, DOI, or full-record URL, e.g. WOS:001335131500001 or 10.1016/j.patter.2024.101046');
    }

    const database = normalizeDatabase(kwargs.database, identifier.database ?? 'woscc');

    // Extract DOI and UT from the identifier
    const doi = identifier.kind === 'doi' ? identifier.value : '';
    const ut = identifier.kind === 'ut' ? identifier.value : '';

    // Step 1: Query OpenAlex for OA URL (if DOI is available)
    const openalexWork = doi ? await fetchOpenAlexWork(doi) : null;

    // Step 2: Scrape WoS record page for full-text links (if UT is available)
    let wosLinks: Array<{ label: string; url: string }> = [];
    let wosAvailable = false;
    if (ut) {
      try {
        const recordUrl = fullRecordUrl(database, ut);
        wosLinks = await scrapeWosFullTextLinks(page, recordUrl);
        wosAvailable = true;
      } catch {
        // WoS scraper failed; continue with whatever OpenAlex returned
      }
    }

    const result = buildFullTextResult({ openalexWork, wosLinks, wosAvailable });

    if (!result.best_url) {
      throw new EmptyResultError(
        'webofscience full-text',
        'No full-text entry URL found. The record may not have an open-access version, or your WoS session may not have access.',
      );
    }

    return Object.entries(result).map(([field, value]) => ({
      field,
      value: Array.isArray(value) ? value.join('; ') : String(value),
    }));
  },
});
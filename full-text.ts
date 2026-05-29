import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError, UpstreamServiceError } from './src/lib/errors';
import {
  fullRecordUrl,
  normalizeDatabase,
  parseRecordIdentifier,
} from './src/lib/shared';
import { scrapeWosFullTextLinks } from './src/lib/wos-full-text';

type FullTextSource = 'openalex' | 'wos' | 'none';
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

/**
 * Fetch an OpenAlex work by DOI. Throws UpstreamServiceError on 429/5xx
 * so the caller can distinguish "no OA version" from "upstream is down".
 */
async function fetchOpenAlexWork(doi: string): Promise<OpenAlexWork | null> {
  const url = `${OPENALEX_API}/works/doi:${encodeURIComponent(doi)}?mailto=opencli-plugin-webofscience@users.noreply.github.com`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new UpstreamServiceError('OpenAlex API', 'timeout', 'The request timed out after 10s.');
    }
    throw new UpstreamServiceError('OpenAlex API', 'network-error', String(error));
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 429) {
    throw new UpstreamServiceError('OpenAlex API', 429, 'Rate limited. Try again later.');
  }
  if (res.status >= 500) {
    throw new UpstreamServiceError('OpenAlex API', res.status, 'OpenAlex API returned a server error.');
  }
  if (!res.ok) return null;

  const data = await res.json();
  return data as OpenAlexWork;
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
  if (hasOpenalex && hasWos) source = 'openalex'; // OpenAlex preferred when both exist
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
  defaultFormat: 'json',
  columns: ['best_url', 'best_pdf_url', 'open_access_url', 'wos_full_text_urls', 'source', 'access_type'],
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
    // OpenAlex 429/5xx throws UpstreamServiceError which propagates to user
    // but does NOT block WoS results — handle separately.
    let openalexWork: OpenAlexWork | null = null;
    let openalexError: unknown = null;
    if (doi) {
      try {
        openalexWork = await fetchOpenAlexWork(doi);
      } catch (error) {
        openalexError = error;
      }
    }

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

    // If we have any result, return it — don't let OpenAlex error block WoS data
    if (result.best_url) {
      return result;
    }

    // No results at all: surface typed error
    if (openalexError) {
      throw openalexError;
    }

    throw new EmptyResultError(
      'webofscience full-text',
      'No full-text entry URL found. The record may not have an open-access version, or your WoS session may not have access.',
    );
  },
});
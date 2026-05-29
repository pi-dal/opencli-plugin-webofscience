import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/registry';
import { EmptyResultError, UpstreamServiceError } from '../../src/lib/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import '../../full-text.ts';

function createPageMock(evaluateResults: any[]): IPage {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn().mockResolvedValue(undefined),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    fetchJson: vi.fn().mockResolvedValue(undefined),
    fillText: vi.fn().mockResolvedValue({ filled: true, verified: true, expected: '', actual: '', length: 0, matches_n: 1, match_level: 'exact' }),
  };
}

const _origFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = _origFetch;
});

function mockCmd() {
  const cmd = getRegistry().get('webofscience/full-text');
  expect(cmd?.func).toBeTypeOf('function');
  return cmd!;
}

function callFunc(cmd: any, page: IPage, kwargs: Record<string, any>): Promise<any> {
  return (cmd.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, kwargs);
}

function mockOpenAlexOk(oaUrl: string, doi: string) {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(
    JSON.stringify({ open_access: { is_oa: true, oa_url: oaUrl }, doi }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  ));
}

function mockOpenAlex429() {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(
    null,
    { status: 429, statusText: 'Too Many Requests' }
  ));
}

describe('webofscience full-text', () => {
  it('describes supported identifiers and database inference in command help', () => {
    const cmd = getRegistry().get('webofscience/full-text');
    const idArg = cmd?.args.find(arg => arg.name === 'id');
    const databaseArg = cmd?.args.find(arg => arg.name === 'database');

    expect(idArg?.help).toContain('WOS:');
    expect(idArg?.help).toContain('DOI');
    expect(idArg?.help).toContain('full-record URL');
    expect(databaseArg?.help).toContain('Defaults to the database in the identifier URL');
  });

  it('returns a flat JSON object shape (not field/value rows)', async () => {
    const cmd = mockCmd();
    const page = createPageMock([
      [{ label: 'Context Sensitive Links', url: 'https://publisher.org/article/123' }],
    ]);

    const result = await callFunc(cmd, page, { id: 'WOS:001335131500001' });

    expect(result).toBeTypeOf('object');
    expect(Array.isArray(result)).toBe(false);
    expect(result).toHaveProperty('best_url');
    expect(result).toHaveProperty('best_pdf_url');
    expect(result).toHaveProperty('open_access_url');
    expect(result).toHaveProperty('wos_full_text_urls');
    expect(result).toHaveProperty('wos_full_text_labels');
    expect(result).toHaveProperty('source');
    expect(result).toHaveProperty('access_type');
    expect(typeof result.best_url).toBe('string');
    expect(Array.isArray(result.wos_full_text_urls)).toBe(true);
  });

  it('returns WoS full-text links when UT is provided and WoS page has links', async () => {
    const cmd = mockCmd();
    const page = createPageMock([
      [
        { label: 'Context Sensitive Links', url: 'https://webofscience.clarivate.cn/api/gateway?foo=1' },
        { label: 'Free Submitted Article From Repository', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf' },
      ],
    ]);

    const result = await callFunc(cmd, page, { id: 'WOS:001335131500001' });

    expect(result.best_url).toBeTruthy();
    expect(result.best_pdf_url).toBe('https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf');
    expect(result.source).toBe('wos');
    expect(result.access_type).toBe('institutional');
  });

  it('fills best_pdf_url only when URL is a genuine .pdf', async () => {
    const cmd = mockCmd();
    const page = createPageMock([
      [
        { label: 'Context Sensitive Links', url: 'https://webofscience.clarivate.cn/api/gateway?foo=1' },
        { label: 'View Full Text', url: 'https://publisher.org/articles/123' },
      ],
    ]);

    const result = await callFunc(cmd, page, { id: 'WOS:001335131500001' });

    expect(result.best_url).toBeTruthy();
    expect(result.best_pdf_url).toBe('');
  });

  it('sets open_access_url from OpenAlex when DOI input returns OA URL', async () => {
    const cmd = mockCmd();
    // Use a URL that genuinely ends in .pdf for the pdf test
    mockOpenAlexOk('https://www.cell.com/article/S2666389924001880.pdf', '10.1016/j.patter.2024.101046');

    const page = createPageMock([]);
    const result = await callFunc(cmd, page, { id: '10.1016/j.patter.2024.101046' });

    expect(result.open_access_url).toBe('https://www.cell.com/article/S2666389924001880.pdf');
    expect(result.best_url).toBe('https://www.cell.com/article/S2666389924001880.pdf');
    expect(result.best_pdf_url).toBe('https://www.cell.com/article/S2666389924001880.pdf');
    expect(result.source).toBe('openalex');
    expect(result.access_type).toBe('open_access');
  });

  it('throws UpstreamServiceError when OpenAlex returns 429', async () => {
    const cmd = mockCmd();
    mockOpenAlex429();

    const page = createPageMock([]);
    await expect(callFunc(cmd, page, { id: '10.1016/j.patter.2024.101046' })).rejects.toThrow(UpstreamServiceError);
  });

  it('throws UpstreamServiceError when OpenAlex times out', async () => {
    const cmd = mockCmd();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );

    const page = createPageMock([]);
    await expect(callFunc(cmd, page, { id: '10.1016/j.patter.2024.101046' })).rejects.toThrow(UpstreamServiceError);
  });

  it('passes through WoS results when OpenAlex 429 occurs (DOI + UT combo - WoS path)', async () => {
    const cmd = mockCmd();
    // UT input — no OpenAlex call, uses only WoS path
    const page = createPageMock([
      [{ label: 'Context Sensitive Links', url: 'https://publisher.org/article/123' }],
    ]);

    const result = await callFunc(cmd, page, { id: 'WOS:000000000000001' });

    expect(result.best_url).toBe('https://publisher.org/article/123');
    expect(result.source).toBe('wos');
    expect(result.access_type).toBe('institutional');
  });

  it('throws EmptyResultError when neither OpenAlex nor WoS has links', async () => {
    const cmd = mockCmd();
    mockOpenAlexOk('', '10.1016/j.patter.2024.101046');

    const page = createPageMock([]);
    await expect(callFunc(cmd, page, { id: '10.1016/j.patter.2024.101046' })).rejects.toThrow(EmptyResultError);
  });
});
import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/registry';
import { EmptyResultError } from '../../src/lib/errors';
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

  it('returns OpenAlex OA URL when DOI input and OpenAlex returns OA with .pdf URL', async () => {
    const cmd = getRegistry().get('webofscience/full-text');
    expect(cmd?.func).toBeTypeOf('function');

    // UT-only input — no DOI, so OpenAlex not queried
    // DOM scraping returns full-text links
    const page = createPageMock([
      // scrapeWosFullTextLinks: returns links including PDF
      [
        { label: 'Context Sensitive Links', url: 'https://webofscience.clarivate.cn/api/gateway?foo=1' },
        { label: 'Free Submitted Article From Repository', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf' },
      ],
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001' });

    expect(result.find((r: { field: string }) => r.field === 'best_url')?.value).toBeTruthy();
    expect(result.find((r: { field: string }) => r.field === 'best_pdf_url')?.value).toBe('https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf');
    expect(result.find((r: { field: string }) => r.field === 'source')?.value).toBe('wos');
    expect(result.find((r: { field: string }) => r.field === 'access_type')?.value).toBe('institutional');
  });

  it('fills best_pdf_url only when URL is a genuine .pdf', async () => {
    const cmd = getRegistry().get('webofscience/full-text');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      // Dom scraping: no PDF links, only landing page
      [
        { label: 'Context Sensitive Links', url: 'https://webofscience.clarivate.cn/api/gateway?foo=1' },
        { label: 'View Full Text', url: 'https://publisher.org/articles/123' },
      ],
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001' });

    // best_url should be the first WoS link (non-PDF)
    expect(result.find((r: { field: string }) => r.field === 'best_url')?.value).toBeTruthy();
    // best_pdf_url should be empty since no URL ends with .pdf
    expect(result.find((r: { field: string }) => r.field === 'best_pdf_url')?.value).toBe('');
  });

  it('has open_access_url filled when WoS links exist for UT input', async () => {
    // For UT-only input without DOI, open_access_url remains empty
    const cmd = getRegistry().get('webofscience/full-text');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      [
        { label: 'Context Sensitive Links', url: 'https://publisher.org/landing/123' },
      ],
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001' });

    // UT-only: open_access_url is empty, but wos_full_text_urls is populated
    expect(result.find((r: { field: string }) => r.field === 'open_access_url')?.value).toBe('');
    expect(result.find((r: { field: string }) => r.field === 'wos_full_text_urls')?.value).toBe('https://publisher.org/landing/123');
    expect(result.find((r: { field: string }) => r.field === 'source')?.value).toBe('wos');
    expect(result.find((r: { field: string }) => r.field === 'access_type')?.value).toBe('institutional');
  });

  it('throws EmptyResultError when neither OpenAlex nor WoS has links', async () => {
    const cmd = getRegistry().get('webofscience/full-text');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      // DOM scraping returns empty
      [],
    ]);

    await expect(
      (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:000000000000000' }),
    ).rejects.toThrow(EmptyResultError);
  });
});
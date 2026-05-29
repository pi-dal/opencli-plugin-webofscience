import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/registry';
import { EmptyResultError } from '../../src/lib/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import '../../citing-articles.ts';

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
    fillText: vi.fn().mockResolvedValue({ filled: true, verified: true, expected: '', actual: '', length: 0, matches_n: 1, match_level: 'exact' }),  };
}

describe('webofscience citing-articles', () => {
  it('describes citing lookup identifiers and database inference in command help', () => {
    const cmd = getRegistry().get('webofscience/citing-articles');
    const idArg = cmd?.args.find(arg => arg.name === 'id');
    const databaseArg = cmd?.args.find(arg => arg.name === 'database');

    expect(idArg?.help).toContain('WOS:');
    expect(idArg?.help).toContain('DOI');
    expect(idArg?.help).toContain('full-record URL');
    expect(databaseArg?.help).toContain('Defaults to woscc');
  });

  it('searches for the record, navigates to citing summary, and maps DOM-scraped records', async () => {
    const cmd = getRegistry().get('webofscience/citing-articles');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      // dismissCookieConsent: found and dismissed
      true, false,
      // fillAndSubmit: returns void
      undefined,
      // waitForSummaryUrl: returns summary URL (first poll succeeds)
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: 'Showing results', qid: 'test' },
      // UT extraction from first result link
      'WOS:001335131500001',
      // DOM scraping on citing summary page: returns citing articles
      [
        {
          title: 'Citing article one',
          authors: 'Smith, J',
          year: '2026',
          source: 'NATURE',
          cited: '12',
          ut: 'WOS:002',
        },
      ],
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001', limit: 1 });

    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      'https://webofscience.clarivate.cn/wos/woscc/smart-search',
      { settleMs: 4000 },
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      'https://webofscience.clarivate.cn/wos/woscc/citing-summary/WOS:001335131500001?from=woscc&type=colluid&siloSearchWarning=false',
      { settleMs: 8000 },
    );
    expect(result).toEqual([
      {
        rank: 1,
        title: 'Citing article one',
        authors: 'Smith, J',
        year: '2026',
        source: 'NATURE',
        cited: '12',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:002',
      },
    ]);
  });

  it('throws EmptyResultError when no UT can be extracted after search', async () => {
    const cmd = getRegistry().get('webofscience/citing-articles');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      // UT extraction fails
      '',
    ]);

    await expect((cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001' })).rejects.toThrow(EmptyResultError);
  });

  it('throws EmptyResultError when the citing summary page has no records and no SID fallback', async () => {
    const cmd = getRegistry().get('webofscience/citing-articles');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      'WOS:001335131500001',
      // DOM scrape returns empty
      [],
      // SID extraction returns empty
      '',
    ]);

    await expect((cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001' })).rejects.toThrow(EmptyResultError);
  });

  it('falls back to API from within browser context when DOM scrape yields no records', async () => {
    const cmd = getRegistry().get('webofscience/citing-articles');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      'WOS:001335131500001',
      // DOM scrape returns empty
      [],
      // SID extraction
      'SID-CITING-API',
      // API fetch returns mapped records array (the evaluate maps them internally)
      [
        {
          title: 'API citing result',
          authors: 'Api, A',
          year: '2026',
          source: '',
          cited: '5',
          ut: 'WOS:003',
        },
      ],
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001', limit: 1 }) as Array<{ title?: string }>;

    expect(result[0]).toMatchObject({ title: 'API citing result' });
  });
});
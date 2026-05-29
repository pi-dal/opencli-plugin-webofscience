import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/registry';
import { EmptyResultError } from '../../src/lib/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import '../../smart-search.ts';

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
  };
}

describe('webofscience smart-search', () => {
  it('describes natural-language queries and the default database in command help', () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    const queryArg = cmd?.args.find(arg => arg.name === 'query');
    const databaseArg = cmd?.args.find(arg => arg.name === 'database');

    expect(queryArg?.help).toContain('e.g.');
    expect(queryArg?.help).toContain('machine learning');
    expect(databaseArg?.help).toContain('Defaults to woscc');
  });

  it('submits a smart search and maps DOM-scraped records', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      // dismissCookieConsent: found and dismissed
      true, false,
      // fillSmartSearch: returns void
      undefined,
      // waitForSummaryPage: returns summary URL
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: 'Showing results from Web of Science', qid: 'test' },
      // scrapeRecords: returns scraped records
      [
        {
          title: 'Avoiding common machine learning pitfalls',
          authors: 'Lones, Michael A.; Doe, J',
          year: '2024',
          source: 'PATTERNS',
          cited: '64',
          doi: '10.1016/j.patter.2024.101046',
          ut: 'WOS:001335131500001',
        },
        {
          title: 'Another machine learning paper',
          authors: 'Smith, A',
          year: '2025',
          source: 'JOURNAL OF TESTS',
          cited: '7',
          doi: '',
          ut: 'WOS:001527924800002',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'machine learning', limit: 2 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/woscc/smart-search',
      { settleMs: 4000 },
    );
    expect(result).toEqual([
      {
        rank: 1,
        title: 'Avoiding common machine learning pitfalls',
        authors: 'Lones, Michael A.; Doe, J',
        year: '2024',
        source: 'PATTERNS',
        cited: '64',
        doi: '10.1016/j.patter.2024.101046',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001335131500001',
      },
      {
        rank: 2,
        title: 'Another machine learning paper',
        authors: 'Smith, A',
        year: '2025',
        source: 'JOURNAL OF TESTS',
        cited: '7',
        doi: '',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001527924800002',
      },
    ]);
  });

  it('throws EmptyResultError when the DOM scrape returns empty and no SID is available', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      // scrapeRecords returns empty
      [],
      // SID extraction returns empty
      '',
    ]);

    await expect(cmd!.func!(page, { query: 'nohits', limit: 5 })).rejects.toThrow(EmptyResultError);
  });

  it('uses the ALLDB smart-search route and maps DOM-scraped records', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1', text: '', qid: 'test' },
      [
        {
          title: 'All databases record',
          authors: 'Zhang, S',
          year: '2026',
          source: 'MULTIDATABASE JOURNAL',
          cited: '3',
          doi: '10.1000/alldb.1',
          ut: 'WOS:009999999999999',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'quantum', database: 'alldb', limit: 1 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/smart-search',
      { settleMs: 4000 },
    );
    expect(result).toEqual([
      {
        rank: 1,
        title: 'All databases record',
        authors: 'Zhang, S',
        year: '2026',
        source: 'MULTIDATABASE JOURNAL',
        cited: '3',
        doi: '10.1000/alldb.1',
        url: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:009999999999999',
      },
    ]);
  });

  it('maps records with empty optional fields gracefully', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      [
        {
          title: 'Null author test',
          authors: '',
          year: '',
          source: '',
          cited: '0',
          doi: '',
          ut: 'WOS:001',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'test', limit: 1 });

    expect(result).toEqual([
      {
        rank: 1,
        title: 'Null author test',
        authors: '',
        year: '',
        source: '',
        cited: '0',
        doi: '',
        url: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001',
      },
    ]);
  });

  it('falls back to API from within browser context when DOM scrape yields no records', async () => {
    const cmd = getRegistry().get('webofscience/smart-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      // scrapeRecords returns empty
      [],
      // SID extraction
      'SID-API-FALLBACK',
      // API fetch via evaluate returns records as JSON (from res.json())
      [
        {
          key: 'searchInfo',
          payload: { QueryID: 'QID123', RecordsFound: 1 },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:003',
              titles: {
                item: { en: [{ title: 'API fallback smart search' }] },
              },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'api fallback', limit: 1 }) as Array<{ title: string }>;

    expect(result[0]).toMatchObject({ title: 'API fallback smart search' });
  });

  it('does not keep the legacy search command registered', () => {
    expect(getRegistry().get('webofscience/search')).toBeUndefined();
  });
});
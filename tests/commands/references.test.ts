import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/registry';
import { EmptyResultError } from '../../src/lib/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { parseWosEventStream } from '../../src/lib/shared';
import '../../references.ts';

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

describe('webofscience references', () => {
  it('describes reference lookup identifiers and database inference in command help', () => {
    const cmd = getRegistry().get('webofscience/references');
    const idArg = cmd?.args.find(arg => arg.name === 'id');
    const databaseArg = cmd?.args.find(arg => arg.name === 'database');

    expect(idArg?.help).toContain('WOS:');
    expect(idArg?.help).toContain('DOI');
    expect(idArg?.help).toContain('full-record URL');
    expect(databaseArg?.help).toContain('Defaults to woscc');
  });

  it('parses summary stream payloads that arrive as a JSON array', () => {
    expect(parseWosEventStream(JSON.stringify([
      { key: 'searchInfo', payload: { QueryID: 'QIDREFS', RecordsFound: 2 } },
      { key: 'records', payload: { 1: { ut: 'WOS:001' }, 2: { ut: 'WOS:002' } } },
    ]))).toEqual([
      { key: 'searchInfo', payload: { QueryID: 'QIDREFS', RecordsFound: 2 } },
      { key: 'records', payload: { 1: { ut: 'WOS:001' }, 2: { ut: 'WOS:002' } } },
    ]);
  });

  it('searches for the record, navigates to cited references summary, and maps DOM-scraped records', async () => {
    const cmd = getRegistry().get('webofscience/references');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      // dismissCookieConsent: found and dismissed
      true, false,
      // fillAndSubmit: returns void
      undefined,
      // waitForSummaryUrl: returns summary URL
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: 'Showing results', qid: 'test' },
      // UT extraction from first result link
      'WOS:001335131500001',
      // DOM scraping on cited-references summary page: returns references
      [
        {
          title: 'SCIENCE',
          authors: 'Doe, J',
          year: '2021',
          source: 'SCIENCE',
          cited: '7',
          ut: '123456789',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { id: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:001335131500001', limit: 1 });

    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      'https://webofscience.clarivate.cn/wos/alldb/smart-search',
      { settleMs: 4000 },
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      'https://webofscience.clarivate.cn/wos/alldb/cited-references-summary/WOS:001335131500001?from=alldb&type=colluid',
      { settleMs: 8000 },
    );
    expect(result).toEqual([
      {
        rank: 1,
        title: 'SCIENCE',
        authors: 'Doe, J',
        year: '2021',
        source: 'SCIENCE',
        cited: '7',
        url: 'https://webofscience.clarivate.cn/wos/alldb/full-record/123456789',
      },
    ]);
  });

  it('throws EmptyResultError when no UT can be extracted after search', async () => {
    const cmd = getRegistry().get('webofscience/references');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      // UT extraction fails
      '',
    ]);

    await expect(cmd!.func!(page, { id: 'WOS:001335131500001' })).rejects.toThrow(EmptyResultError);
  });

  it('throws EmptyResultError when the cited references summary has no records and no SID fallback', async () => {
    const cmd = getRegistry().get('webofscience/references');
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

    await expect(cmd!.func!(page, { id: 'WOS:001335131500001' })).rejects.toThrow(EmptyResultError);
  });

  it('falls back to API from within browser context when DOM scrape yields no records', async () => {
    const cmd = getRegistry().get('webofscience/references');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '', qid: 'test' },
      'WOS:001335131500001',
      // DOM scrape returns empty
      [],
      // SID extraction
      'SID-REFS-API',
      // API fetch returns mapped records array
      [
        {
          title: 'REFERENCE ONE',
          authors: 'Ref, A',
          year: '2024',
          source: 'REF JOURNAL',
          cited: '2',
          ut: 'WOS:999',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { id: 'WOS:001335131500001', limit: 1 }) as Array<{ title?: string }>;

    expect(result[0]).toMatchObject({ title: 'REFERENCE ONE' });
  });
});
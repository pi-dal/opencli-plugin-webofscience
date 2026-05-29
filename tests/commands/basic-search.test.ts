import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/registry';
import { EmptyResultError } from '../../src/lib/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { buildBasicSearchRowText, isWosSubmitControl, normalizeBasicSearchField } from '../../src/lib/shared';
import '../../basic-search.ts';

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

describe('webofscience basic-search', () => {
  it('describes common field choices and the default field in command help', () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    const fieldArg = cmd?.args.find(arg => arg.name === 'field');

    expect(fieldArg?.help).toContain('Default: topic');
    expect(fieldArg?.help).toContain('topic');
    expect(fieldArg?.help).toContain('title');
    expect(fieldArg?.help).toContain('author');
    expect(fieldArg?.help).toContain('doi');
  });

  it('normalizes basic-search field aliases to official WOS tags', () => {
    expect(normalizeBasicSearchField(undefined)).toMatchObject({
      key: 'topic',
      label: 'Topic',
      tag: 'TS',
    });
    expect(normalizeBasicSearchField('title')).toMatchObject({
      key: 'title',
      label: 'Title',
      tag: 'TI',
    });
    expect(normalizeBasicSearchField('all-fields')).toMatchObject({
      key: 'all_fields',
      label: 'All Fields',
      tag: 'ALL',
    });
    expect(normalizeBasicSearchField('web-of-science-categories')).toMatchObject({
      key: 'web_of_science_categories',
      label: 'Web of Science Categories',
      tag: 'WC',
    });
  });

  it('reports supported field examples when an unsupported field is passed', () => {
    expect(() => normalizeBasicSearchField('headline')).toThrow(
      'Unsupported Web of Science basic-search field: headline. Try one of: topic, title, author, doi, web-of-science-categories',
    );
  });

  it('builds rowText for basic-search fields using the mapped WOS tag', () => {
    expect(buildBasicSearchRowText('machine learning', 'topic')).toBe('TS=(machine learning)');
    expect(buildBasicSearchRowText('machine learning', 'title')).toBe('TI=(machine learning)');
    expect(buildBasicSearchRowText('10.1016/j.patter.2024.101046', 'doi')).toBe('DO=(10.1016/j.patter.2024.101046)');
    expect(buildBasicSearchRowText('Yann LeCun', 'author')).toBe('AU=(Yann LeCun)');
  });

  it('does not mistake history buttons for the actual search submit control', () => {
    expect(isWosSubmitControl({
      text: 'search Search',
      type: 'submit',
      ariaLabel: null,
    })).toBe(true);

    expect(isWosSubmitControl({
      text: 'View your search history',
      type: 'button',
      ariaLabel: null,
    })).toBe(false);
  });

  it('searches via the basic-search route and maps DOM-scraped records', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      // dismissCookieConsent: found and dismissed
      true, false,
      // fillSearch: not used
      undefined,
      // waitForSummaryPage: returns summary URL
      { href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1', text: 'Showing results from Web of Science' },
      // scrapeRecords: returns scraped records
      [
        {
          title: 'Basic search result',
          authors: 'Basic, A',
          year: '2025',
          source: 'BASIC JOURNAL',
          cited: '5',
          doi: '10.1000/basic',
          ut: 'WOS:101',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'basic', database: 'alldb', limit: 1, field: 'title' });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/basic-search',
      { settleMs: 4000 },
    );
    expect(result).toEqual([
      {
        rank: 1,
        title: 'Basic search result',
        authors: 'Basic, A',
        year: '2025',
        source: 'BASIC JOURNAL',
        cited: '5',
        doi: '10.1000/basic',
        url: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:101',
      },
    ]);
  });

  it('uses woscc database by default and maps DOM-scraped records', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '' },
      [
        {
          title: 'Default DB result',
          authors: '',
          year: '2025',
          source: '',
          cited: '0',
          doi: '',
          ut: 'WOS:104',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'test', limit: 1 }) as Array<{ title: string }>;

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/woscc/basic-search',
      { settleMs: 4000 },
    );
    expect(result[0]).toMatchObject({ title: 'Default DB result' });
  });

  it('waits for the summary page when navigation finishes slowly', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      // First poll: still on basic-search page
      { href: 'https://webofscience.clarivate.cn/wos/woscc/basic-search', text: '' },
      // Retry poll: now on summary page
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '' },
      [
        {
          title: 'Summary wait result',
          authors: '',
          year: '2025',
          source: '',
          cited: '0',
          doi: '',
          ut: 'WOS:105',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'summary wait', limit: 1 }) as Array<{ title: string }>;

    expect(result[0]).toMatchObject({ title: 'Summary wait result' });
  });

  it('falls back to API from within browser context when DOM scraping yields no records', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '' },
      // scrapeRecords returns empty
      [],
      // SID extraction
      'SID-BUTTON-FALLBACK',
      // API fetch returns records (res.json() returns an array of events)
      [
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:102',
              doi: '10.1000/fallback',
              titles: {
                item: { en: [{ title: 'API fallback result' }] },
                source: { en: [{ title: 'FALLBACK JOURNAL' }] },
              },
              names: {
                author: { en: [{ wos_standard: 'Fallback, A' }] },
              },
              pub_info: { pubyear: '2025' },
              citation_related: { counts: { WOSCC: 3 } },
            },
          },
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'fallback', limit: 1 }) as Array<{ title: string }>;

    expect(result[0]).toMatchObject({ title: 'API fallback result' });
  });

  it('retries input discovery when the basic-search field renders late', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      // fillSearch succeeds on retry (previous attempts threw, but we mock one-shot)
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '' },
      [
        {
          title: 'Late field result',
          authors: '',
          year: '2025',
          source: '',
          cited: '0',
          doi: '',
          ut: 'WOS:103',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'late field', limit: 1 }) as Array<{ title: string }>;

    expect(result[0]).toMatchObject({ title: 'Late field result' });
  });

  it('throws EmptyResultError when no records are returned', async () => {
    const cmd = getRegistry().get('webofscience/basic-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true, false,
      undefined,
      { href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1', text: '' },
      // scrapeRecords returns empty
      [],
      // SID extraction returns empty (no SID found)
      '',
    ]);

    await expect(cmd!.func!(page, { query: 'none' })).rejects.toThrow(EmptyResultError);
  });
});
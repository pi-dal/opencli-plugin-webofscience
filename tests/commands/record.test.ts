import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '../../src/lib/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { extractSupplementMetadataFromText } from '../../record.ts';
import '../../record.ts';

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

describe('webofscience record', () => {
  it('describes supported record identifiers and database inference in command help', () => {
    const cmd = getRegistry().get('webofscience/record');
    const idArg = cmd?.args.find(arg => arg.name === 'id');
    const databaseArg = cmd?.args.find(arg => arg.name === 'database');

    expect(idArg?.help).toContain('WOS:');
    expect(idArg?.help).toContain('DOI');
    expect(idArg?.help).toContain('full-record URL');
    expect(databaseArg?.help).toContain('Defaults to the database in the URL');
  });

  it('extracts structured metadata from full-record page text blocks', () => {
    const body = `Keywords
Keywords PlusNEURAL-NETWORKSSELECTION
Author Information
Corresponding Address
Lones, Michael A.
(corresponding author)
arrow_drop_down
Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
E-mail Addresses
m.lones@hw.ac.uk
Addresses
arrow_drop_down
1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
E-mail Addresses
m.lones@hw.ac.uk
Categories/ Classification
Research AreasComputer Science
Citation Topics
6 Social Sciences
Web of Science Categories
Computer Science, Artificial IntelligenceComputer Science, Information SystemsComputer Science, Interdisciplinary Applications
add
See more data fields
Journal information
PATTERNS
Research Areas
Computer Science
Web of Science Categories
Computer Science, Artificial IntelligenceComputer Science, Information SystemsComputer Science, Interdisciplinary Applications Language English Accession Number WOS:001335131500001 PubMed ID 39569205
7.4`;

    expect(extractSupplementMetadataFromText(body)).toMatchObject({
      corresponding_address: 'Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
      author_addresses: '1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
      email_addresses: 'm.lones@hw.ac.uk',
      research_areas: 'Computer Science',
      wos_categories: 'Computer Science, Artificial Intelligence; Computer Science, Information Systems; Computer Science, Interdisciplinary Applications',
    });
  });

  it('extracts author-level affiliation references from full-record page text', () => {
    const body = `Author Information
By
Lones, Michael A.1,2
Doe, Jane3
Addresses
1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
2 National Robotarium, Edinburgh, Scotland
3 Example University, School of Computing, Boston, MA, USA
E-mail Addresses
m.lones@hw.ac.uk
jane@example.edu`;

    expect(extractSupplementMetadataFromText(body)).toMatchObject({
      authors_structured: JSON.stringify([
        {
          name: 'Lones, Michael A.',
          address_refs: ['1', '2'],
          addresses: [
            'Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
            'National Robotarium, Edinburgh, Scotland',
          ],
        },
        {
          name: 'Doe, Jane',
          address_refs: ['3'],
          addresses: [
            'Example University, School of Computing, Boston, MA, USA',
          ],
        },
      ]),
    });
  });

  it('strips trailing metadata labels from inline wos categories text', () => {
    const body = `Web of Science Categories
Computer Science, Artificial IntelligenceComputer Science, Information SystemsComputer Science, Interdisciplinary Applications Language English Accession Number WOS:001335131500001 PubMed ID 39569205`;

    expect(extractSupplementMetadataFromText(body)).toMatchObject({
      wos_categories: 'Computer Science, Artificial Intelligence; Computer Science, Information Systems; Computer Science, Interdisciplinary Applications',
    });
  });

  it('extracts inline metadata and keyword sections from full-record text when API fields are missing', () => {
    const body = `Keywords
Author Keywords
machine learning
best practices
Keywords Plus
NEURAL NETWORKS
SELECTION
Author Information
By
Lones, Michael A.
Corresponding Address
Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
E-mail Addresses
m.lones@hw.ac.uk
Addresses
1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
Categories/ Classification
Research Areas
Computer Science
Web of Science Categories
Computer Science, Artificial Intelligence
Computer Science, Information Systems
Language
English
Accession Number
WOS:001335131500001
PubMed ID
39569205
ISSN
2666-3899
IDS Number
J1Z8Y
Journal information
Current Publisher
CELL PRESS
50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139
Journal Impact Factor`;

    expect(extractSupplementMetadataFromText(body)).toMatchObject({
      author_keywords: 'machine learning; best practices',
      keywords_plus: 'NEURAL NETWORKS; SELECTION',
      language: 'English',
      pubmed_id: '39569205',
      issn: '2666-3899',
      ids_number: 'J1Z8Y',
      current_publisher: 'CELL PRESS; 50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139',
      authors_structured: JSON.stringify([
        {
          name: 'Lones, Michael A.',
          address_refs: [],
          addresses: [],
        },
      ]),
    });
  });

  it('normalizes noisy document type and concatenated research areas from page text', () => {
    const body = `Document Type
Article Jump to arrow_downward Enriched Cited References
Abstract
Example abstract
Research Areas
EngineeringOperations Research & Management Science
Web of Science Categories
Engineering, Industrial`;

    expect(extractSupplementMetadataFromText(body)).toMatchObject({
      document_type: 'Article',
      research_areas: 'Engineering; Operations Research & Management Science',
    });
  });

  it('trims noisy ids number decorations from page text', () => {
    const body = `IDS Number
5MP6P Treatment From Inspec® View record in Inspec® Treatment BibliographyPracticalExperimental
Journal information`;

    expect(extractSupplementMetadataFromText(body)).toMatchObject({
      ids_number: '5MP6P',
    });
  });

  it('fetches a full record by UT using the ALLDB database when provided', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID555', href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID555',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:001335131500001',
              doi: '10.1016/j.patter.2024.101046',
              coll: 'WOSCC',
              titles: {
                item: { en: [{ title: 'Avoiding common machine learning pitfalls' }] },
                source: { en: [{ title: 'PATTERNS' }] },
              },
              names: {
                author: {
                  en: [
                    { wos_standard: 'Lones, M A' },
                    { wos_standard: 'Doe, J' },
                  ],
                },
              },
              pub_info: { pubyear: '2024' },
              citation_related: { counts: { WOSCC: 64, ALLDB: 81 } },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:001335131500001',
            doi: '10.1016/j.patter.2024.101046',
            coll: 'WOSCC',
            titles: {
              item: { en: [{ title: 'Avoiding common machine learning pitfalls' }] },
              source: { en: [{ title: 'PATTERNS' }] },
            },
            names: {
              author: {
                en: [
                  { wos_standard: 'Lones, M A' },
                  { wos_standard: 'Doe, J' },
                ],
              },
            },
            pub_info: {
              pubyear: '2024',
              sortdate: '2024-09-01',
            },
            abstract: {
              basic: {
                en: {
                  abstract: '<p>A concise <b>abstract</b> for testing.</p>',
                },
              },
            },
            keywords: {
              author_keywords: {
                en: [{ keyword: 'machine learning' }, { keyword: 'best practices' }],
              },
              keywords_plus: {
                en: [{ keyword: 'pitfalls' }],
              },
            },
            citation_related: {
              counts: {
                WOSCC: 64,
                ALLDB: 81,
              },
            },
          },
        },
      ],
      {
        metadata: {
          document_type: 'Review',
          article_number: '101046',
          published: 'OCT 11 2024',
          early_access: 'OCT 2024',
          indexed: '2024-10-25',
          language: 'English',
          pubmed_id: '39569205',
          issn: '2666-3899',
          ids_number: 'J1Z8Y',
          corresponding_address: 'Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
          author_addresses: '1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland',
          email_addresses: 'm.lones@hw.ac.uk',
          research_areas: 'Computer Science',
          wos_categories: 'Computer Science, Artificial Intelligence; Computer Science, Information Systems; Computer Science, Interdisciplinary Applications',
          authors_structured: JSON.stringify([
            {
              name: 'Lones, Michael A.',
              address_refs: ['1'],
              addresses: ['Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland'],
            },
          ]),
          current_publisher: 'CELL PRESS50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139',
          cited_references: '71',
        },
        fullTextLinks: [
          {
            label: 'Context Sensitive Links',
            url: 'https://webofscience.clarivate.cn/api/gateway?foo=1',
          },
          {
            label: 'Free Submitted Article From Repository',
            url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf',
          },
        ],
      },
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001', database: 'alldb' });

    expect(page.goto).toHaveBeenNthCalledWith(1,
      'https://webofscience.clarivate.cn/wos/alldb/basic-search',
      { settleMs: 4000 },
    );
    expect(page.typeText).toHaveBeenCalledWith('#search-option-0', 'UT=(WOS:001335131500001)');
    expect(page.goto).toHaveBeenNthCalledWith(2,
      'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:001335131500001',
      { settleMs: 4000 },
    );

    const searchJs = vi.mocked(page.evaluate).mock.calls[1]?.[0];
    expect(searchJs).toContain('"rowText":"UT=(WOS:001335131500001)"');
    expect(searchJs).toContain('"product":"ALLDB"');

    const fullRecordJs = vi.mocked(page.evaluate).mock.calls[2]?.[0];
    expect(fullRecordJs).toContain('/api/wosnx/core/getFullRecordByQueryId?SID=');
    expect(fullRecordJs).toContain('"qid":"QID555"');
    expect(fullRecordJs).toContain('"id":1');
    expect(fullRecordJs).toContain('"product":"ALLDB"');
    expect(fullRecordJs).toContain('"searchMode":"general_semantic"');

    expect(result).toEqual([
      { field: 'title', value: 'Avoiding common machine learning pitfalls' },
      { field: 'authors', value: 'Lones, M A; Doe, J' },
      { field: 'year', value: '2024' },
      { field: 'source', value: 'PATTERNS' },
      { field: 'doi', value: '10.1016/j.patter.2024.101046' },
      { field: 'ut', value: 'WOS:001335131500001' },
      { field: 'abstract', value: 'A concise abstract for testing.' },
      { field: 'document_type', value: 'Review' },
      { field: 'article_number', value: '101046' },
      { field: 'published', value: 'OCT 11 2024' },
      { field: 'early_access', value: 'OCT 2024' },
      { field: 'indexed', value: '2024-10-25' },
      { field: 'language', value: 'English' },
      { field: 'pubmed_id', value: '39569205' },
      { field: 'issn', value: '2666-3899' },
      { field: 'ids_number', value: 'J1Z8Y' },
      { field: 'corresponding_address', value: 'Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland' },
      { field: 'author_addresses', value: '1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland' },
      { field: 'email_addresses', value: 'm.lones@hw.ac.uk' },
      { field: 'research_areas', value: 'Computer Science' },
      { field: 'wos_categories', value: 'Computer Science, Artificial Intelligence; Computer Science, Information Systems; Computer Science, Interdisciplinary Applications' },
      { field: 'authors_structured', value: JSON.stringify([
        {
          name: 'Lones, Michael A.',
          address_refs: ['1'],
          addresses: ['Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland'],
        },
      ]) },
      { field: 'current_publisher', value: 'CELL PRESS50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139' },
      { field: 'author_keywords', value: 'machine learning; best practices' },
      { field: 'keywords_plus', value: 'pitfalls' },
      { field: 'citations_woscc', value: '64' },
      { field: 'citations_alldb', value: '81' },
      { field: 'cited_references', value: '71' },
      { field: 'full_text_links', value: 'Context Sensitive Links; Free Submitted Article From Repository' },
      { field: 'full_text_urls', value: 'https://webofscience.clarivate.cn/api/gateway?foo=1; https://pmc.ncbi.nlm.nih.gov/articles/PMC11573893/pdf/main.pdf' },
      { field: 'url', value: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:001335131500001' },
    ]);
  });

  it('retries supplement scraping when the first full-record page scrape is empty', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SIDRETRY', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QIDRETRY',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:RETRY1',
              titles: {
                item: { en: [{ title: 'Retry supplement result' }] },
              },
              citation_related: { counts: { WOSCC: 1 } },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:RETRY1',
            titles: {
              item: { en: [{ title: 'Retry supplement result' }] },
            },
            citation_related: { counts: { WOSCC: 1 } },
          },
        },
      ],
      {},
      {
        bodyText: `Document Type
Review
Abstract
Current Publisher
Retry Publisher
Journal Impact Factor`,
        fullTextLinks: [],
      },
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:RETRY1' }) as Array<{ field: string; value: string }>;

    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:RETRY1',
      { settleMs: 4000 },
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      3,
      'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:RETRY1',
      { settleMs: 4000 },
    );
    expect(result).toContainEqual({ field: 'document_type', value: 'Review' });
    expect(result).toContainEqual({ field: 'current_publisher', value: 'Retry Publisher' });
  });

  it('accepts a full-record URL and infers the database from the path', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID777', href: 'https://webofscience.clarivate.cn/wos/alldb/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID777',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:009999999999999',
              coll: 'WOSCC',
              titles: {
                item: { en: [{ title: 'URL input record' }] },
              },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:009999999999999',
            titles: {
              item: { en: [{ title: 'URL input record' }] },
            },
          },
        },
      ],
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, {
      id: 'https://webofscience.clarivate.cn/wos/alldb/full-record/WOS:009999999999999',
    }) as Array<{ field: string; value: string }>;

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/alldb/basic-search',
      { settleMs: 4000 },
    );
    expect(page.typeText).toHaveBeenCalledWith('#search-option-0', 'UT=(WOS:009999999999999)');
    expect(result[0]).toEqual({ field: 'title', value: 'URL input record' });
  });

  it('throws for an unsupported record identifier', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([]);
    await expect((cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'not-a-record' })).rejects.toThrow(ArgumentError);
  });

  it('throws EmptyResultError when the exact record cannot be found', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SID404', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QID404',
            RecordsFound: 0,
          },
        },
        {
          key: 'records',
          payload: {},
        },
      ],
    ]);

    await expect((cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001404' })).rejects.toThrow(EmptyResultError);
  });

  it('falls back to Enter when the submit button is unavailable', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      null,
      { sid: 'SIDENTER', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QIDENTER',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:003',
              titles: {
                item: { en: [{ title: 'Enter fallback record' }] },
              },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:003',
            titles: {
              item: { en: [{ title: 'Enter fallback record' }] },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.click).mockRejectedValueOnce(new Error('Element not found'));

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:003' });

    expect(page.pressKey).toHaveBeenCalledWith('Enter');
    expect(result).toBeTruthy();
  });

  it('falls back to the matched search record when full-record fetch fails', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SIDFB', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QIDFB',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:004',
              doi: '10.1000/fallback',
              titles: {
                item: { en: [{ title: 'Fallback summary record' }] },
                source: { en: [{ title: 'SUMMARY SOURCE' }] },
              },
              names: {
                author: {
                  en: [{ wos_standard: 'Fallback, A' }],
                },
              },
              pub_info: { pubyear: '2023' },
              citation_related: {
                counts: {
                  WOSCC: 9,
                },
              },
            },
          },
        },
      ],
    ]);
    vi.mocked(page.evaluate).mockRejectedValueOnce(new Error('Unexpected token <'));

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:004' });

    expect(result).toEqual([
      { field: 'title', value: 'Fallback summary record' },
      { field: 'authors', value: 'Fallback, A' },
      { field: 'year', value: '2023' },
      { field: 'source', value: 'SUMMARY SOURCE' },
      { field: 'doi', value: '10.1000/fallback' },
      { field: 'ut', value: 'WOS:004' },
      { field: 'citations_woscc', value: '9' },
      { field: 'url', value: 'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:004' },
    ]);
  });

  it('falls back to page metadata for keyword and identifier fields when the API payload omits them', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SIDMETA', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QIDMETA',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:001335131500001',
              titles: {
                item: { en: [{ title: 'Metadata fallback record' }] },
              },
              citation_related: { counts: { WOSCC: 64, ALLDB: 67 } },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:001335131500001',
            titles: {
              item: { en: [{ title: 'Metadata fallback record' }] },
            },
            citation_related: { counts: { WOSCC: 64, ALLDB: 67 } },
          },
        },
      ],
      {
        bodyText: `Keywords
Author Keywords
machine learning
best practices
Keywords Plus
NEURAL NETWORKS
SELECTION
Author Information
By
Lones, Michael A.
Corresponding Address
Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
E-mail Addresses
m.lones@hw.ac.uk
Addresses
1 Heriot Watt Univ, Sch Math & Comp Sci, Edinburgh, Scotland
Categories/ Classification
Research Areas
Computer Science
Web of Science Categories
Computer Science, Artificial Intelligence
Computer Science, Information Systems
Language
English
Accession Number
WOS:001335131500001
PubMed ID
39569205
ISSN
2666-3899
IDS Number
J1Z8Y
Journal information
Current Publisher
CELL PRESS
50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139
Journal Impact Factor`,
        fullTextLinks: [],
      },
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001335131500001' }) as Array<{ field: string; value: string }>;

    expect(result).toContainEqual({ field: 'author_keywords', value: 'machine learning; best practices' });
    expect(result).toContainEqual({ field: 'keywords_plus', value: 'NEURAL NETWORKS; SELECTION' });
    expect(result).toContainEqual({ field: 'language', value: 'English' });
    expect(result).toContainEqual({ field: 'pubmed_id', value: '39569205' });
    expect(result).toContainEqual({ field: 'issn', value: '2666-3899' });
    expect(result).toContainEqual({ field: 'ids_number', value: 'J1Z8Y' });
    expect(result).toContainEqual({
      field: 'current_publisher',
      value: 'CELL PRESS; 50 HAMPSHIRE ST, FLOOR 5, CAMBRIDGE, MA 02139',
    });
    expect(result).toContainEqual({
      field: 'authors_structured',
      value: JSON.stringify([
        {
          name: 'Lones, Michael A.',
          address_refs: [],
          addresses: [],
        },
      ]),
    });
  });

  it('falls back to scraping the full-record page when exact search session establishment fails for a UT', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([]);
    vi.mocked(page.evaluate)
      .mockRejectedValueOnce(new Error('Search session blocked by passive verification'))
      .mockResolvedValueOnce({
        bodyText: `Causal machine learning for supply chain risk prediction and intervention planning
By
Wyrembek, Mateusz
George Baryannis
Alexandra Brintrup
Source
INTERNATIONAL JOURNAL OF PRODUCTION RESEARCH
Document Type
Article Jump to arrow_downward Enriched Cited References
DOI
10.1080/00207543.2025.2458121
Abstract
This is a fallback abstract from the full-record page.
Keywords
Author Keywords
causal machine learning
supply chains
Keywords Plus
RISK PREDICTION
Published
AUG 3 2025
Research Areas
EngineeringOperations Research & Management Science
Language
English
Accession Number
WOS:001411195100001`,
        fullTextLinks: [],
      });

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001411195100001' }) as Array<{ field: string; value: string }>;

    expect(page.goto).toHaveBeenNthCalledWith(
      1,
      'https://webofscience.clarivate.cn/wos/woscc/basic-search',
      { settleMs: 4000 },
    );
    expect(page.goto).toHaveBeenNthCalledWith(
      2,
      'https://webofscience.clarivate.cn/wos/woscc/full-record/WOS:001411195100001',
      { settleMs: 4000 },
    );
    expect(result).toContainEqual({
      field: 'title',
      value: 'Causal machine learning for supply chain risk prediction and intervention planning',
    });
    expect(result).toContainEqual({
      field: 'authors',
      value: 'Wyrembek, Mateusz; George Baryannis; Alexandra Brintrup',
    });
    expect(result).toContainEqual({ field: 'year', value: '2025' });
    expect(result).toContainEqual({ field: 'source', value: 'INTERNATIONAL JOURNAL OF PRODUCTION RESEARCH' });
    expect(result).toContainEqual({ field: 'doi', value: '10.1080/00207543.2025.2458121' });
    expect(result).toContainEqual({ field: 'ut', value: 'WOS:001411195100001' });
    expect(result).toContainEqual({ field: 'abstract', value: 'This is a fallback abstract from the full-record page.' });
    expect(result).toContainEqual({ field: 'document_type', value: 'Article' });
    expect(result).toContainEqual({ field: 'research_areas', value: 'Engineering; Operations Research & Management Science' });
  });

  it('uses author names from supplemental full-text links when the API returns only one author and suppresses noisy full-text dumps', async () => {
    const cmd = getRegistry().get('webofscience/record');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      { sid: 'SIDAUTH', href: 'https://webofscience.clarivate.cn/wos/woscc/summary/test/relevance/1' },
      [
        {
          key: 'searchInfo',
          payload: {
            QueryID: 'QIDAUTH',
            RecordsFound: 1,
          },
        },
        {
          key: 'records',
          payload: {
            1: {
              ut: 'WOS:001411195100001',
              doi: '10.1080/00207543.2025.2458121',
              titles: {
                item: { en: [{ title: 'Causal machine learning for supply chain risk prediction and intervention planning' }] },
                source: { en: [{ title: 'INTERNATIONAL JOURNAL OF PRODUCTION RESEARCH' }] },
              },
              names: {
                author: {
                  en: [{ wos_standard: 'Wyrembek, Mateusz' }],
                },
              },
              pub_info: { pubyear: '2025' },
            },
          },
        },
      ],
      [
        {
          key: 'full-record',
          payload: {
            ut: 'WOS:001411195100001',
            doi: '10.1080/00207543.2025.2458121',
            titles: {
              item: { en: [{ title: 'Causal machine learning for supply chain risk prediction and intervention planning' }] },
              source: { en: [{ title: 'INTERNATIONAL JOURNAL OF PRODUCTION RESEARCH' }] },
            },
            names: {
              author: {
                en: [{ wos_standard: 'Wyrembek, Mateusz' }],
              },
            },
            pub_info: { pubyear: '2025' },
          },
        },
      ],
      {
        metadata: {
          document_type: 'Article',
          authors_structured: JSON.stringify([
            {
              name: 'Wyrembek, Mateusz',
              address_refs: ['1'],
              addresses: ['Poznan Univ Econ & Business, Dept Logist, Poznan, Poland'],
            },
          ]),
        },
        fullTextLinks: [
          {
            label: 'Context Sensitive Links',
            url: 'https://webofscience.clarivate.cn/api/gateway?DestURL=https%3A%2F%2Fresolver.example.test%2Fresult%3Frft.au%3DWyrembek%252C%2BMateusz%26rft.au%3DBaryannis%252C%2BGeorge%26rft.au%3DBrintrup%252C%2BAlexandra',
          },
          { label: 'Extra 1', url: 'https://example.com/1.pdf' },
          { label: 'Extra 2', url: 'https://example.com/2.pdf' },
          { label: 'Extra 3', url: 'https://example.com/3.pdf' },
          { label: 'Extra 4', url: 'https://example.com/4.pdf' },
          { label: 'Extra 5', url: 'https://example.com/5.pdf' },
          { label: 'Extra 6', url: 'https://example.com/6.pdf' },
          { label: 'Extra 7', url: 'https://example.com/7.pdf' },
          { label: 'Extra 8', url: 'https://example.com/8.pdf' },
        ],
      },
    ]);

    const result = await (cmd!.func as (page: IPage, kwargs: Record<string, any>) => Promise<any>)(page, { id: 'WOS:001411195100001' }) as Array<{ field: string; value: string }>;

    expect(result).toContainEqual({
      field: 'authors',
      value: 'Wyrembek, Mateusz; Baryannis, George; Brintrup, Alexandra',
    });
    expect(result).toContainEqual({
      field: 'authors_structured',
      value: JSON.stringify([
        {
          name: 'Wyrembek, Mateusz',
          address_refs: ['1'],
          addresses: ['Poznan Univ Econ & Business, Dept Logist, Poznan, Poland'],
        },
        {
          name: 'Baryannis, George',
          address_refs: [],
          addresses: [],
        },
        {
          name: 'Brintrup, Alexandra',
          address_refs: [],
          addresses: [],
        },
      ]),
    });
    expect(result.find(row => row.field === 'full_text_links')).toBeUndefined();
    expect(result.find(row => row.field === 'full_text_urls')).toBeUndefined();
  });
});

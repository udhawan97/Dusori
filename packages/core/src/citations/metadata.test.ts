import { describe, expect, it } from 'vitest';

import { CitationMetadataSchema } from '../schemas/workspace.js';
import {
  citationIdentifierText,
  citationMetadataFromKnownValues,
  mergeCitationMetadata,
  normalizeCitationIdentifier,
} from './metadata.js';

const capturedAt = new Date('2026-08-29T12:00:00.000Z');

describe('citation identifier normalization', () => {
  it('normalizes persistent scholarly and catalog identifiers without I/O', () => {
    expect(normalizeCitationIdentifier('DOI', 'https://doi.org/10.1000/ABC.2')).toEqual({
      scheme: 'doi',
      value: '10.1000/abc.2',
    });
    expect(normalizeCitationIdentifier('isbn', 'ISBN-13: 978-0-306-40615-7')).toEqual({
      scheme: 'isbn',
      value: '9780306406157',
    });
    expect(normalizeCitationIdentifier('arxiv', 'https://arxiv.org/pdf/1706.03762v7.pdf')).toEqual({
      scheme: 'arxiv',
      value: '1706.03762v7',
    });
    expect(
      normalizeCitationIdentifier('pmid', 'https://pubmed.ncbi.nlm.nih.gov/12345678/'),
    ).toEqual({ scheme: 'pmid', value: '12345678' });
    expect(
      normalizeCitationIdentifier('pmcid', 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC123456/'),
    ).toEqual({ scheme: 'pmcid', value: 'PMC123456' });
    expect(normalizeCitationIdentifier('openalex', 'https://openalex.org/W2023953679')).toEqual({
      scheme: 'openalex',
      value: 'W2023953679',
    });
    expect(
      normalizeCitationIdentifier('openlibrary', 'https://openlibrary.org/works/OL17898000W'),
    ).toEqual({ scheme: 'openlibrary', value: 'OL17898000W' });
  });

  it('rejects malformed values and invalid ISBN checksums', () => {
    expect(normalizeCitationIdentifier('doi', '10/not-a-doi')).toBeNull();
    expect(normalizeCitationIdentifier('isbn', '978-0-306-40615-8')).toBeNull();
    expect(normalizeCitationIdentifier('pmid', '../../123')).toBeNull();
    expect(normalizeCitationIdentifier('unknown', 'value')).toBeNull();
  });
});

describe('citation metadata', () => {
  it('combines provider fields, keys, and URLs into one bounded normalized record', () => {
    const metadata = citationMetadataFromKnownValues({
      candidateKey: 'europepmc:MED:12345678',
      capturedAt,
      consentScope: 'europepmc',
      itemType: 'paper',
      meta: {
        doi: '10.1000/Clinical.1',
        journal: 'Journal of Learning Medicine',
        pmcid: 'PMC123456',
        pmid: '12345678',
      },
      provider: 'europepmc',
      url: 'https://doi.org/10.1000/clinical.1',
    });

    expect(metadata).toEqual({
      schemaVersion: 'dusori-citation-v1',
      identifiers: [
        { scheme: 'doi', value: '10.1000/clinical.1' },
        { scheme: 'pmid', value: '12345678' },
        { scheme: 'pmcid', value: 'PMC123456' },
      ],
      containerTitle: 'Journal of Learning Medicine',
      itemType: 'paper',
      provenance: [
        {
          capturedAt: capturedAt.toISOString(),
          consentScope: 'europepmc',
          method: 'provider-result',
          provider: 'europepmc',
        },
      ],
    });
    expect(metadata?.identifiers.map(citationIdentifierText)).toEqual([
      'DOI: 10.1000/clinical.1',
      'PMID: 12345678',
      'PMCID: PMC123456',
    ]);
  });

  it('records URL-only normalization locally and performs no resolver work', () => {
    expect(
      citationMetadataFromKnownValues({
        capturedAt,
        url: 'https://arxiv.org/abs/1706.03762',
      }),
    ).toMatchObject({
      identifiers: [{ scheme: 'arxiv', value: '1706.03762' }],
      provenance: [{ method: 'source-url' }],
    });
    expect(citationMetadataFromKnownValues({ capturedAt, url: 'https://example.org' })).toBe(
      undefined,
    );
  });

  it('merges identifiers without growing duplicate consent receipts', () => {
    const first = citationMetadataFromKnownValues({
      capturedAt,
      provider: 'crossref',
      candidateKey: 'crossref:10.1000/one',
    });
    const second = citationMetadataFromKnownValues({
      capturedAt: new Date('2026-08-30T12:00:00.000Z'),
      identifiers: [{ scheme: 'pmid', value: '12345678' }],
      provider: 'crossref',
    });

    expect(mergeCitationMetadata(first, second)).toMatchObject({
      identifiers: [
        { scheme: 'doi', value: '10.1000/one' },
        { scheme: 'pmid', value: '12345678' },
      ],
      provenance: [{ capturedAt: capturedAt.toISOString(), provider: 'crossref' }],
    });
  });

  it('requires explicit consent provenance for any future resolver receipt', () => {
    expect(() =>
      CitationMetadataSchema.parse({
        schemaVersion: 'dusori-citation-v1',
        identifiers: [{ scheme: 'doi', value: '10.1000/example' }],
        provenance: [{ capturedAt: capturedAt.toISOString(), method: 'resolver' }],
      }),
    ).toThrow(/consent scope/iu);
  });
});

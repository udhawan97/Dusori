import { describe, expect, it } from 'vitest';

import { CitationMetadataSchema } from '../schemas/workspace.js';
import {
  citationIdentifierLines,
  citationIdentifierText,
  citationMetadataFromManualCorrection,
  citationMetadataFromKnownValues,
  mergeCitationMetadata,
  normalizeCitationIdentifier,
  parseCitationIdentifierLines,
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
    expect(
      normalizeCitationIdentifier('pmcid', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC123456/'),
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

  it('parses learner-edited identifier lines, normalizes aliases, and removes duplicates', () => {
    const identifiers = parseCitationIdentifierLines(
      'DOI: https://doi.org/10.1000/ABC.2\nOpen Library: OL17898000W\ndoi: 10.1000/abc.2',
    );

    expect(identifiers).toEqual([
      { scheme: 'doi', value: '10.1000/abc.2' },
      { scheme: 'openlibrary', value: 'OL17898000W' },
    ]);
    expect(citationIdentifierLines(identifiers)).toBe(
      'DOI: 10.1000/abc.2\nOpen Library: OL17898000W',
    );
  });

  it('rejects incomplete or invalid learner-edited identifier lines', () => {
    expect(() => parseCitationIdentifierLines('')).toThrow(/at least one/iu);
    expect(() => parseCitationIdentifierLines('DOI 10.1000/example')).toThrow(/scheme: value/iu);
    expect(() => parseCitationIdentifierLines('ISBN: 978-0-306-40615-8')).toThrow(/not a valid/iu);
    expect(() =>
      parseCitationIdentifierLines(
        Array.from({ length: 17 }, (_item, index) => `PMID: ${index + 1}`).join('\n'),
      ),
    ).toThrow(/at most 16/iu);
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

  it('keeps learner-corrected fields authoritative during later provider enrichment', () => {
    const discovered = CitationMetadataSchema.parse({
      ...citationMetadataFromKnownValues({
        capturedAt,
        provider: 'crossref',
        candidateKey: 'crossref:10.1000/wrong',
        meta: { journal: 'Wrong journal' },
      }),
      futureCitationHint: { retain: true },
    });
    const corrected = citationMetadataFromManualCorrection(discovered, {
      capturedAt: new Date('2026-08-30T12:00:00.000Z'),
      containerTitle: 'Correct journal',
      identifiers: [{ scheme: 'doi', value: '10.5555/correct' }],
    });
    const enriched = CitationMetadataSchema.parse({
      ...citationMetadataFromKnownValues({
        capturedAt: new Date('2026-08-30T13:00:00.000Z'),
        consentScope: 'openalex-search',
        identifiers: [{ scheme: 'doi', value: '10.1000/wrong' }],
        itemType: 'paper',
        meta: { journal: 'Provider journal' },
        provider: 'openalex',
      }),
      futureProviderHint: { retain: true },
    });

    expect(mergeCitationMetadata(corrected, enriched)).toEqual({
      schemaVersion: 'dusori-citation-v1',
      identifiers: [{ scheme: 'doi', value: '10.5555/correct' }],
      containerTitle: 'Correct journal',
      itemType: 'paper',
      futureCitationHint: { retain: true },
      futureProviderHint: { retain: true },
      provenance: [
        expect.objectContaining({ method: 'provider-result', provider: 'crossref' }),
        expect.objectContaining({ method: 'provider-result', provider: 'openalex' }),
        expect.objectContaining({ method: 'manual-correction' }),
      ],
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

  it('replaces editable fields while preserving prior receipts and recording a local correction', () => {
    const current = CitationMetadataSchema.parse({
      ...citationMetadataFromKnownValues({
        capturedAt,
        provider: 'crossref',
        candidateKey: 'crossref:10.1000/one',
        meta: { journal: 'Old journal' },
      }),
      futureCitationHint: { retain: true },
    });

    expect(
      citationMetadataFromManualCorrection(current, {
        capturedAt: new Date('2026-08-30T12:00:00.000Z'),
        containerTitle: '  New   journal  ',
        identifiers: [
          { scheme: 'arxiv', value: '1706.03762v2' },
          { scheme: 'doi', value: '10.5555/ATTENTION.2026' },
        ],
      }),
    ).toEqual({
      schemaVersion: 'dusori-citation-v1',
      identifiers: [
        { scheme: 'doi', value: '10.5555/attention.2026' },
        { scheme: 'arxiv', value: '1706.03762v2' },
      ],
      containerTitle: 'New journal',
      futureCitationHint: { retain: true },
      provenance: [
        {
          capturedAt: capturedAt.toISOString(),
          consentScope: 'crossref',
          method: 'provider-result',
          provider: 'crossref',
        },
        { capturedAt: '2026-08-30T12:00:00.000Z', method: 'manual-correction' },
      ],
    });
  });

  it('bounds correction history without evicting original consent provenance', () => {
    let current = citationMetadataFromKnownValues({
      capturedAt,
      provider: 'crossref',
      consentScope: 'crossref-search',
      candidateKey: 'crossref:10.1000/one',
    })!;

    for (let index = 0; index < 10; index += 1) {
      current = citationMetadataFromManualCorrection(current, {
        capturedAt: new Date(Date.UTC(2026, 7, 30, 13, index)),
        identifiers: [{ scheme: 'doi', value: `10.5555/correction.${index}` }],
      });
    }

    expect(current.provenance).toHaveLength(9);
    expect(current.provenance[0]).toMatchObject({
      consentScope: 'crossref-search',
      method: 'provider-result',
      provider: 'crossref',
    });
    expect(
      current.provenance.filter((receipt) => receipt.method === 'manual-correction'),
    ).toHaveLength(8);
  });
});

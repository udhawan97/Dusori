import { describe, expect, it } from 'vitest';

import { acceptMarkdownUpdate } from '../conflict/write-protocol.js';
import { exportWorkspace, importWorkspace } from '../portable.js';
import { MemoryStorageAdapter } from '../testing/memory-storage.js';
import { createTopic, createWorkspace } from '../workspace/create.js';
import { applyCurriculum, parseCurriculum, renderCurriculumRoadmap } from './import.js';

const now = new Date('2026-07-20T18:00:00.000Z');

const microsoftLearnGuide = `# Study guide for Exam AI-901

## Skills measured as of April 15, 2026

### Audience profile

This paragraph is not an objective.

### Skills at a glance

- Identify AI concepts and capabilities (40–45%)
- Build lightweight AI applications (55–60%)

### Identify AI concepts and capabilities (40–45%)

#### Describe generative AI concepts

- Identify common generative AI scenarios
- Describe responsible AI considerations

### Build lightweight AI applications (55–60%)

#### Implement information extraction

- Extract information from documents and forms

## Study resources

- Find documentation
`;

const awsExamGuide = `AWS Certified Solutions Architect - Associate (SAA-C03) Exam Guide

Introduction
The AWS Certified Solutions Architect - Associate (SAA-C03) exam is intended for individuals
who perform in a solutions architect role.

Content outline
The exam has the following content domains and weightings:
• Domain 1: Design Secure Architectures (30% of scored content)
• Domain 2: Design Resilient Architectures (26% of scored content)
• Domain 3: Design High-Performing Architectures (24% of scored content)
• Domain 4: Design Cost-Optimized Architectures (20% of scored content)

Domain 1: Design Secure Architectures
Task Statement 1.1: Design secure access to AWS resources.
Knowledge of:
• Access controls and management across multiple accounts
• AWS federated access and identity services (for example, AWS Identity and Access
Management [IAM], AWS IAM Identity Center)
Skills in:
• Applying AWS security best practices to IAM users and root users
Task Statement 1.2: Design secure workloads and
applications.
Knowledge of:
• Application configuration and credentials security
Domain 2: Design Resilient Architectures
Task Statement 2.1: Design scalable and loosely coupled architectures.
Domain 3: Design High-Performing Architectures
Task Statement 3.1: Determine high-performing and/or scalable storage solutions.
Domain 4: Design Cost-Optimized Architectures
Task Statement 4.1: Design cost-optimized storage solutions.
`;

describe('curriculum adapters', () => {
  it('extracts Microsoft Learn skill groups without duplicating the skills-at-a-glance list', () => {
    const draft = parseCurriculum({
      adapterId: 'auto',
      content: microsoftLearnGuide,
      sourceTitle: 'AI-901 official study guide',
      sourceUrl:
        'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-901',
    });

    expect(draft.adapterId).toBe('microsoft-learn');
    expect(draft.objectives).toEqual([
      { depth: 1, title: 'Identify AI concepts and capabilities', weight: '40–45%' },
      { depth: 2, title: 'Describe generative AI concepts' },
      { depth: 3, title: 'Identify common generative AI scenarios' },
      { depth: 3, title: 'Describe responsible AI considerations' },
      { depth: 1, title: 'Build lightweight AI applications', weight: '55–60%' },
      { depth: 2, title: 'Implement information extraction' },
      { depth: 3, title: 'Extract information from documents and forms' },
    ]);
  });

  it('turns a structured Markdown syllabus into a portable outline', () => {
    const draft = parseCurriculum({
      adapterId: 'structured-markdown',
      content: `# Foundations of typography

## Letterforms
- Anatomy and terminology
- Contrast and stress

## Typesetting
### Reading rhythm
- Measure and leading
`,
      sourceTitle: 'Foundations syllabus',
    });

    expect(draft.adapterId).toBe('structured-markdown');
    expect(draft.objectives).toEqual([
      { depth: 1, title: 'Letterforms' },
      { depth: 2, title: 'Anatomy and terminology' },
      { depth: 2, title: 'Contrast and stress' },
      { depth: 1, title: 'Typesetting' },
      { depth: 2, title: 'Reading rhythm' },
      { depth: 3, title: 'Measure and leading' },
    ]);
    expect(renderCurriculumRoadmap(draft)).toContain('- [ ] Anatomy and terminology');

    const singleHeading = parseCurriculum({
      adapterId: 'structured-markdown',
      content: '# Practical typography\n- Compare two typefaces\n- Set one readable paragraph',
      sourceTitle: 'Practical typography',
    });
    expect(singleHeading.objectives).toEqual([
      { depth: 1, title: 'Practical typography' },
      { depth: 2, title: 'Compare two typefaces' },
      { depth: 2, title: 'Set one readable paragraph' },
    ]);
  });

  it('recognizes AWS exam guide text pasted from the PDF', () => {
    const draft = parseCurriculum({
      adapterId: 'auto',
      content: awsExamGuide,
      sourceTitle: 'SAA-C03 exam guide',
      sourceUrl: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/',
    });

    expect(draft.adapterId).toBe('aws-exam-guide');
    expect(draft.adapterLabel).toBe('AWS Certification exam guide');
    expect(draft.objectives).toEqual([
      { depth: 1, title: 'Design Secure Architectures', weight: '30%' },
      { depth: 2, title: 'Design secure access to AWS resources' },
      { depth: 2, title: 'Design secure workloads and applications' },
      { depth: 1, title: 'Design Resilient Architectures', weight: '26%' },
      { depth: 2, title: 'Design scalable and loosely coupled architectures' },
      { depth: 1, title: 'Design High-Performing Architectures', weight: '24%' },
      { depth: 2, title: 'Determine high-performing and/or scalable storage solutions' },
      { depth: 1, title: 'Design Cost-Optimized Architectures', weight: '20%' },
      { depth: 2, title: 'Design cost-optimized storage solutions' },
    ]);
    expect(renderCurriculumRoadmap(draft)).toContain('## Design Secure Architectures (30%)');
  });

  it('reads task-statement variants and keeps tasks without domain headings usable', () => {
    const cloudPractitioner = parseCurriculum({
      adapterId: 'auto',
      content: [
        'Domain 1: Cloud Concepts 24%',
        'Domain 2: Security and Compliance 30%',
        'Task statement 1.1: Define the benefits of the AWS Cloud.',
        'Task statement 1.2: Identify design principles of the AWS Cloud.',
        'Task statement 2.1: Understand the AWS shared responsibility model.',
      ].join('\n'),
      sourceTitle: 'CLF-C02 exam guide',
    });
    expect(cloudPractitioner.adapterId).toBe('aws-exam-guide');
    expect(cloudPractitioner.objectives).toEqual([
      { depth: 1, title: 'Cloud Concepts', weight: '24%' },
      { depth: 2, title: 'Define the benefits of the AWS Cloud' },
      { depth: 2, title: 'Identify design principles of the AWS Cloud' },
      { depth: 1, title: 'Security and Compliance', weight: '30%' },
      { depth: 2, title: 'Understand the AWS shared responsibility model' },
    ]);

    const tasksOnly = parseCurriculum({
      adapterId: 'aws-exam-guide',
      content: 'Task Statement 1.1: Do a thing.\nTask Statement 1.2: Do another thing.',
      sourceTitle: 'Partial paste',
    });
    expect(tasksOnly.objectives).toEqual([
      { depth: 1, title: 'Do a thing' },
      { depth: 1, title: 'Do another thing' },
    ]);
  });

  it('rejects unsupported, oversized, and unsafe curriculum input', () => {
    expect(() =>
      parseCurriculum({
        adapterId: 'auto',
        content: 'One paragraph without an outline.',
        sourceTitle: 'Loose notes',
      }),
    ).toThrow(/Microsoft Learn.*AWS exam guide.*headings and list items/u);
    expect(() =>
      parseCurriculum({
        adapterId: 'auto',
        content: '# A\n## B\n- C',
        sourceTitle: 'Unsafe URL',
        sourceUrl: 'file:///private/outline.md',
      }),
    ).toThrow(/http:\/\/ or https:\/\//u);
    expect(() =>
      parseCurriculum({
        adapterId: 'auto',
        content: `# A\n## B\n- ${'x'.repeat(524_288)}`,
        sourceTitle: 'Too large',
      }),
    ).toThrow(/larger than 512 KiB/u);
  });
});

describe('curriculum application', () => {
  it('stores provenance, updates the roadmap, and survives a ZIP round trip', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'Azure AI', now);
    const draft = parseCurriculum({
      adapterId: 'auto',
      content: microsoftLearnGuide,
      sourceTitle: 'AI-901 official study guide',
      sourceUrl:
        'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-901',
    });

    const applied = await applyCurriculum(storage, topic.topicSlug, draft, now);
    expect(applied.status).toBe('applied');
    const roadmap = await storage.read(`Topics/${topic.topicSlug}/roadmap.md`);
    expect(roadmap?.content).toContain('Imported curriculum');
    expect(roadmap?.content).toContain('Identify AI concepts and capabilities (40–45%)');
    expect(roadmap?.content).toContain('learn.microsoft.com');

    const manifest = await storage.read(`Topics/${topic.topicSlug}/Sources/manifest.json`);
    expect(manifest?.content).toContain('AI-901 official study guide');
    const update = await storage.read(`Topics/${topic.topicSlug}/Updates/2026/07/2026-07-20.md`);
    expect(update?.content).toContain('Added paste source');
    expect(update?.content).toContain('Accepted an explicit update');

    const restored = new MemoryStorageAdapter();
    await importWorkspace(restored, await exportWorkspace(storage));
    expect((await restored.read(`Topics/${topic.topicSlug}/roadmap.md`))?.content).toBe(
      roadmap?.content,
    );
  });

  it('preserves an externally edited roadmap and requires explicit replacement', async () => {
    const storage = new MemoryStorageAdapter();
    await createWorkspace(storage, 'Dusori', now);
    const topic = await createTopic(storage, 'Typography', now);
    const roadmapPath = `Topics/${topic.topicSlug}/roadmap.md`;
    await storage.externalWrite(roadmapPath, '# My edited roadmap\n\nKeep this direction.\n');
    const draft = parseCurriculum({
      adapterId: 'structured-markdown',
      content: '# Typography\n## Letterforms\n- Anatomy\n## Typesetting\n- Measure',
      sourceTitle: 'Typography syllabus',
    });

    const result = await applyCurriculum(storage, topic.topicSlug, draft, now);
    expect(result.status).toBe('conflict');
    expect((await storage.read(roadmapPath))?.content).toContain('Keep this direction.');
    if (result.status === 'conflict') {
      expect(await storage.read(result.conflict.proposalPath)).not.toBeNull();
      await acceptMarkdownUpdate(
        storage,
        topic.topicSlug,
        'roadmap.md',
        result.conflict.proposalContent,
        result.conflict.currentContentHash,
        now,
      );
      expect((await storage.read(roadmapPath))?.content).toContain('Imported curriculum');
    }
  });
});

import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { createResearchProviders } from '@dusori/core';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

// The landing page and the docs index both advertise the current release. Pinning the number here
// made every release edit this file, and it let the two drift apart unnoticed in between. Reading
// the workspace version instead turns these into what they were always meant to prove: the pages
// name the release actually being built, and their links point at it.
const releaseVersion = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
const releaseDocsSlug = `v${releaseVersion.replaceAll('.', '-')}`;
const releaseNotesName = new RegExp(
  `v${releaseVersion.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} release notes`,
  'iu',
);

// Axe's scrollable-region-focusable check only reports a region once it really
// overflows, so short fixtures hide the violation instead of proving its
// absence. Every scroll region under test is fed content past its own
// max-height, and diff rows additionally carry a token no soft wrap can break
// so the horizontal axis overflows too.
const overflowingLines = Array.from(
  { length: 60 },
  (_, index) => `Filler line ${index + 1} pushes this scroll region past its own max-height.`,
).join('\n');

const unbreakableToken = `token-${'x'.repeat(220)}`;

const longObjectiveTitle = Array.from(
  { length: 24 },
  (_, index) => `Explain identity boundary case ${index + 1} in complete sentences`,
).join('; ');

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
Task Statement 1.2: Design secure workloads and
applications.
Domain 2: Design Resilient Architectures
Task Statement 2.1: Design scalable and loosely coupled architectures.
Domain 3: Design High-Performing Architectures
Task Statement 3.1: Determine high-performing and/or scalable storage solutions.
Domain 4: Design Cost-Optimized Architectures
Task Statement 4.1: Design cost-optimized storage solutions.
`;

const microsoftLearnCatalog = {
  modules: [
    {
      duration_in_minutes: 18,
      levels: ['beginner'],
      popularity: 0.92,
      products: ['azure-active-directory'],
      summary: `Learn the terms and boundaries of Microsoft Entra identity management.\n${overflowingLines}`,
      title: 'Establish identity terms with Microsoft Entra',
      uid: 'learn.identity-terms',
      url: 'https://learn.microsoft.com/en-us/training/modules/identity-terms/',
    },
  ],
};

const wikipediaSearch = {
  query: {
    search: [
      {
        pageid: 44779164,
        size: 8948,
        snippet:
          '<span class="searchmatch">Microsoft Entra</span> Connect links local identity infrastructure.',
        title: 'Microsoft Entra Connect',
        wordcount: 746,
      },
    ],
  },
};

// A page extract with real prose under headings, so the deep pass has something to quote.
const wikipediaExtract = {
  query: {
    pages: {
      '44779164': {
        extract: `Microsoft Entra Connect is the Microsoft tool designed to meet and accomplish hybrid identity goals across directories.

== Synchronization ==

Synchronization is responsible for creating users, groups, and other objects, and for making sure identity information for on-premises users matches the cloud.

== Federation ==

Federation is an optional part of Microsoft Entra Connect that can be used to configure a hybrid environment using an on-premises infrastructure.`,
        pageid: 44779164,
        title: 'Microsoft Entra Connect',
      },
    },
  },
};

const reviewSourceText = `# Attention notes

## Attention weights

Attention lets each token weigh every other token in its context window and keep that weighted
sum as its next representation.

## Positional encoding

Attention alone is order-free, so positional encodings put sequence position back into every
representation before the first attention block runs.
`;

const companionHealth = {
  apiVersion: 1,
  service: 'dusori-companion',
  uptime: 1,
  version: '0.2.0',
};

async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  expect(
    results.violations.filter(
      (violation) => violation.impact === 'critical' || violation.impact === 'serious',
    ),
  ).toEqual([]);
}

async function createBrowserWorkspace(page: Page): Promise<void> {
  await page.goto('/Dusori/app/');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'What do you want to understand?' }),
  ).toBeVisible();
}

async function createTopic(
  page: Page,
  options: { remainInResearch?: boolean } = {},
): Promise<void> {
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();
  await expect(
    page.getByRole('heading', { name: 'Let the strongest evidence find you.' }),
  ).toBeVisible();
  await expect(page.getByText(/Allow at least one provider to scan/u)).toBeVisible();
  if (options.remainInResearch) return;

  const workspaceNavigation = page.getByRole('navigation', { name: 'Workspace' });
  if (!(await workspaceNavigation.isVisible())) {
    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
  }
  await workspaceNavigation.getByRole('button', { name: 'AI Fundamentals' }).click();
  await expect(page.getByRole('heading', { name: 'First look at AI Fundamentals' })).toBeVisible();
  await expect(page.getByTitle('Learning flow diagram')).toBeVisible();
  await expect(
    page.frameLocator('iframe[title="Learning flow diagram"]').locator('svg'),
  ).toBeVisible();
}

async function runConflictProof(page: Page): Promise<void> {
  const proof = page.getByRole('button', { name: 'Run conflict proof' });
  if (!(await proof.isVisible())) {
    await page.getByRole('button', { name: 'Open inspector' }).click();
  }
  await page.getByRole('button', { name: 'Run conflict proof' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your external edit stayed untouched.' }),
  ).toBeVisible();
}

async function openInspector(page: Page): Promise<void> {
  const inspector = page.getByRole('complementary', { name: 'Workspace details' });
  if (await inspector.isVisible()) return;
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await expect(inspector).toBeVisible();
}

async function openResearch(page: Page): Promise<void> {
  if (await page.getByRole('heading', { name: 'Sources' }).isVisible()) return;
  const workspaceNavigation = page.getByRole('navigation', { name: 'Workspace' });
  if (!(await workspaceNavigation.isVisible())) {
    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
  }
  await workspaceNavigation.getByRole('button', { name: 'Research' }).click();
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
}

async function addPastedSource(page: Page): Promise<void> {
  await openResearch(page);
  await page.getByLabel('Source title').fill('Transformer notes');
  await page
    .getByLabel('Source text')
    .fill('Attention lets each token weigh the other tokens in its context.');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(
    page.getByText('Source added to this topic and its update log.').first(),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Transformer notes',
  );
}

/** Note filenames in the seeded topic, so a test can prove nothing was written. */
async function noteNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const notes = await (
      await (await dusori.getDirectoryHandle('Topics')).getDirectoryHandle('ai-fundamentals')
    ).getDirectoryHandle('Notes');
    const names: string[] = [];
    for await (const [name] of notes.entries()) names.push(name);
    return names.sort();
  });
}

/** Reaches Today from any width: the workspace navigation collapses on narrow viewports. */
async function openTodayView(page: Page): Promise<void> {
  const workspaceNavigation = page.getByRole('navigation', { name: 'Workspace' });
  const navigationButton = page.getByRole('button', { name: 'Open workspace navigation' });
  await expect(workspaceNavigation.or(navigationButton)).toBeVisible();
  if (await navigationButton.isVisible()) {
    await navigationButton.click();
  }
  await workspaceNavigation.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
}

/** Two headed sections, so a review session has more than one place to draw a prompt from. */
async function addReviewSource(page: Page): Promise<void> {
  await openResearch(page);
  await page.getByLabel('Source title').fill('Attention notes');
  await page.getByLabel('Source text').fill(reviewSourceText);
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('Attention notes');
}

async function reachLastReviewPrompt(page: Page): Promise<void> {
  const session = page.getByRole('dialog', { name: 'AI Fundamentals' });
  const next = session.getByRole('button', { name: 'Next' });
  while (!(await next.isDisabled())) await next.click();
}

async function previewCurriculum(page: Page): Promise<void> {
  if (!(await page.getByRole('heading', { name: 'Curriculum' }).isVisible())) {
    await page.getByRole('button', { name: 'Open inspector' }).click();
  }
  await page.getByRole('button', { name: 'Import curriculum' }).click();
  await page.getByLabel('Source title').last().fill('AI-901 official study guide');
  await page
    .getByLabel('Official page')
    .fill(
      'https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-901',
    );
  await page.getByLabel('Outline text').fill(microsoftLearnGuide);
  await page.getByRole('button', { name: 'Preview roadmap' }).click();
  await expect(page.getByRole('heading', { name: '7 roadmap items' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Curriculum preview' })).toContainText(
    'Describe responsible AI considerations',
  );
}

async function applyCurriculum(page: Page): Promise<void> {
  await previewCurriculum(page);
  await page.getByRole('button', { name: 'Apply roadmap' }).click();
  await expect(page.locator('.learning-loop')).toContainText(
    'Identify AI concepts and capabilities',
  );
  await expect(page.getByRole('heading', { name: 'Curriculum ready.' })).toBeVisible();
}

test('landing, setup, workspace, note, and conflict screens are accessible', async ({ page }) => {
  const cspViolations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) cspViolations.push(message.text());
  });
  await page.goto('/Dusori/');
  await expect(page.getByRole('heading', { name: 'Learn deeply. Keep the files.' })).toBeVisible();
  expect(cspViolations).toEqual([]);
  await expect(page.getByRole('link', { name: /open dusori/iu })).toHaveAttribute(
    'href',
    '/Dusori/app/',
  );
  await expect(page.getByRole('link', { name: 'Docs', exact: true })).toHaveAttribute(
    'href',
    '/Dusori/docs/',
  );
  await expect(page.getByText(`v${releaseVersion} available now`, { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: `v${releaseVersion} available now` }),
  ).toHaveAttribute('href', `https://github.com/udhawan97/Dusori/releases/tag/v${releaseVersion}`);
  await expect(page.getByRole('link', { name: /download zip/iu }).first()).toHaveAttribute(
    'href',
    `https://github.com/udhawan97/Dusori/archive/refs/tags/v${releaseVersion}.zip`,
  );
  await expect(page.getByRole('link', { name: 'See setup' })).toHaveAttribute(
    'href',
    '#run-locally',
  );
  await expectNoSeriousA11yViolations(page);

  await page.goto('/Dusori/docs/');
  await expect(page.getByRole('heading', { name: 'Dusori documentation' })).toBeVisible();
  await expect(page.getByRole('link', { name: releaseNotesName }).first()).toHaveAttribute(
    'href',
    `./releases/${releaseDocsSlug}/`,
  );
  await expectNoSeriousA11yViolations(page);

  await page.goto('/Dusori/app/');
  await expect(
    page.getByRole('heading', { name: 'Make a learning space you can keep.' }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await createBrowserWorkspace(page);
  await expectNoSeriousA11yViolations(page);
  await createTopic(page);
  await expectNoSeriousA11yViolations(page);
  await runConflictProof(page);
  await expect(
    page.getByText('External edit: this sentence must survive.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/\.proposed-.*\.md/u)).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Accept this proposal' }).click();
  await expect(page.getByText('Connect this note to one verified source.')).toBeVisible();
});

test('Today recovers and resolves a pending proposal after reload', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await runConflictProof(page);

  await page.reload();
  await openTodayView(page);
  await expect(page.getByRole('heading', { name: 'Continue learning' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  const attention = page.getByRole('list', { name: 'Needs attention' });
  await expect(attention).toContainText('Review proposal for 001-first-look');
  await attention.getByRole('button', { name: /review proposal.*001-first-look/iu }).click();

  await expect(
    page.getByRole('heading', { name: 'Your external edit stayed untouched.' }),
  ).toBeVisible();
  await expect(
    page.getByText('External edit: this sentence must survive.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep current document' }).click();
  await openTodayView(page);
  await expect(page.getByText('No local evidence needs a decision.')).toBeVisible();

  const proposalState = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const topic = await (
      await (await root.getDirectoryHandle('Dusori')).getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const ledger = await (await topic.getFileHandle('proposals.json')).getFile();
    const proposals = (
      JSON.parse(await ledger.text()) as {
        proposals: Array<{ proposalPath: string; resolution: string }>;
      }
    ).proposals;
    const proposalFile = proposals[0]?.proposalPath.split('/').at(-1) ?? '';
    const notes = await topic.getDirectoryHandle('Notes');
    const proposalStillExists = await notes
      .getFileHandle(proposalFile)
      .then(() => true)
      .catch(() => false);
    return { proposalStillExists, resolution: proposals[0]?.resolution };
  });
  expect(proposalState).toEqual({ proposalStillExists: true, resolution: 'kept' });
});

test('website and docs render distinct, usable light and dark themes', async ({ page }) => {
  const colors = async (): Promise<{ paper: string; ink: string; scheme: string }> =>
    page.evaluate(() => {
      const body = getComputedStyle(document.body);
      return {
        paper: body.backgroundColor,
        ink: body.color,
        scheme: getComputedStyle(document.documentElement).colorScheme,
      };
    });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/Dusori/');
  const websiteLight = await colors();

  await page.emulateMedia({ colorScheme: 'dark' });
  const websiteDark = await colors();

  expect(websiteLight.scheme).toContain('light');
  expect(websiteDark.scheme).toContain('dark');
  expect(websiteDark.paper).not.toBe(websiteLight.paper);
  expect(websiteDark.ink).not.toBe(websiteLight.ink);
  await expectNoSeriousA11yViolations(page);

  await page.goto('/Dusori/docs/');
  const themeSelect = page.getByRole('combobox', { name: 'Select theme' });

  await themeSelect.selectOption('light');
  const docsLight = await colors();
  await themeSelect.selectOption('dark');
  const docsDark = await colors();

  expect(docsLight.scheme).toBe('light');
  expect(docsDark.scheme).toBe('dark');
  expect(docsDark.paper).not.toBe(docsLight.paper);
  expect(docsDark.ink).not.toBe(docsLight.ink);
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await expect(themeSelect).toHaveValue('dark');
  expect(await colors()).toEqual(docsDark);

  await themeSelect.selectOption('auto');
  expect(await colors()).toEqual(docsDark);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(colors).toEqual(docsLight);
});

test('public site explains the identity, Obsidian boundary, and portable graph', async ({
  page,
}) => {
  await page.goto('/Dusori/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://udhawan97.github.io/Dusori/og-dusori.png',
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute('content', '1200');
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute('content', '630');
  const identity = page.getByRole('img', { name: 'Dusori ensō, rangoli, and katana mark' });
  await expect(identity).toBeVisible();
  await expect(identity).toHaveAttribute('src', '/Dusori/brand/dusori-mark-animated.svg');
  await expect(page.locator('.hero-mark source').nth(0)).toHaveAttribute(
    'srcset',
    '/Dusori/brand/dusori-mark-reversed.svg',
  );
  await expect(page.locator('.hero-mark source').nth(1)).toHaveAttribute(
    'srcset',
    '/Dusori/brand/dusori-mark.svg',
  );
  await expect(page.locator('.hero-mark source').nth(2)).toHaveAttribute(
    'srcset',
    '/Dusori/brand/dusori-mark-animated-reversed.svg',
  );
  expect((await identity.boundingBox())?.width).toBeGreaterThanOrEqual(64);
  await expect(page.getByRole('heading', { name: 'Start where you are.' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Your notes stay on speaking terms.' }),
  ).toBeVisible();
  await expect(page.getByText(`The npm companion now matches v${releaseVersion}.`)).toBeVisible();
  await expect(page.locator('#run-locally code')).toHaveText('npx @udhawan97/dusori@latest');

  for (const imageName of [
    'Dusori research view: seven allowed providers, quoted passages read from an approved source, and a per-topic freshness setting',
    'Dusori Today view with evidence-backed learning and attention lanes',
    'Dusori curriculum preview showing Microsoft Learn roadmap items before the user applies them',
    'Dusori knowledge constellation built from portable local artifacts',
  ]) {
    const capture = page.getByRole('img', { name: imageName });
    await capture.scrollIntoViewIfNeeded();
    await expect(capture).toBeVisible();
    await expect
      .poll(() => capture.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(1);
  }

  for (const width of [320, 375, 414, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }

  await page.goto('/Dusori/brand/dusori-mark-animated.svg');
  const chakra = page.locator('.chakra-motion');
  const blade = page.locator('.blade-motion');
  expect(
    await chakra.evaluate((element) => ({
      name: getComputedStyle(element).animationName,
      count: getComputedStyle(element).animationIterationCount,
    })),
  ).toEqual({ name: 'chakra-revolve', count: '1' });
  expect(
    await blade.evaluate((element) => ({
      name: getComputedStyle(element).animationName,
      count: getComputedStyle(element).animationIterationCount,
    })),
  ).toEqual({ name: 'blade-strike', count: '1' });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  expect(await chakra.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  expect(await blade.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  await page.goto('/Dusori/');
  await expect(identity).toBeVisible();
  expect(await identity.evaluate((element) => new URL(element.currentSrc).pathname)).toBe(
    '/Dusori/brand/dusori-mark.svg',
  );

  await page.goto('/Dusori/docs/knowledge-graph/');
  await expect(page.getByRole('heading', { name: 'Portable knowledge graph' })).toBeVisible();
  await expect(page.getByText('No graph database')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('app starts dark and persists an explicit theme choice', async ({ page }) => {
  await page.goto('/Dusori/app/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'dark',
  );

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('dusori-theme'))).toBe('light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('dusori-theme'))).toBe('dark');
  await page.getByRole('button', { name: 'Create workspace' }).evaluate(async (button) => {
    await Promise.all(button.getAnimations().map((animation) => animation.finished));
  });
  await expectNoSeriousA11yViolations(page);
});

test('Obsidian setup explains least-privilege folder access and the portable fallback', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Reflect.deleteProperty(globalThis, 'showDirectoryPicker');
  });
  await page.goto('/Dusori/app/');

  await page.getByRole('button', { name: 'Use Dusori with Obsidian' }).click();
  const guide = page.getByRole('dialog', { name: 'Connect only a Dusori folder.' });
  await expect(guide).toBeVisible();
  await expect(guide.getByText('Open or create your vault in Obsidian.')).toBeVisible();
  await expect(guide.getByText('Create a folder named Dusori inside that vault.')).toBeVisible();
  await expect(
    guide.getByText('Select that Dusori folder here — never the whole vault.'),
  ).toBeVisible();
  await expect(guide.getByText('No Obsidian plugin is required.')).toBeVisible();
  await expect(guide.getByText('Folder connection needs Chrome or Edge on desktop.')).toBeVisible();
  await expect(guide.getByRole('link', { name: 'Use ZIP import instead' })).toHaveAttribute(
    'href',
    '#workspace-import',
  );
  await expectNoSeriousA11yViolations(page);

  await page.keyboard.press('Escape');
  await expect(guide).toBeHidden();
});

test('topic creation writes the complete canonical OPFS tree', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  const paths = await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const found: string[] = [];
    async function visit(directory: FileSystemDirectoryHandle, prefix = ''): Promise<void> {
      for await (const [name, handle] of directory.entries()) {
        const path = prefix ? `${prefix}/${name}` : name;
        found.push(path);
        if (handle.kind === 'directory') await visit(handle, path);
      }
    }
    await visit(root);
    return found.sort();
  });

  expect(paths).toEqual(
    expect.arrayContaining([
      'Home.md',
      'dusori.json',
      'Topics/ai-fundamentals/Overview.md',
      'Topics/ai-fundamentals/roadmap.md',
      'Topics/ai-fundamentals/TUTOR.md',
      'Topics/ai-fundamentals/state.json',
      'Topics/ai-fundamentals/Notes/001-first-look.md',
      'Topics/ai-fundamentals/Sources/manifest.json',
    ]),
  );
  expect(paths.some((path) => /Updates\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}\.md$/u.test(path))).toBe(
    true,
  );
});

test('knowledge graph renders portable artifacts and opens a selected note', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge constellation' })).toBeVisible();
  // Canvas-heavy views close the inspector so the constellation gets the full workspace.
  await expect(page.getByRole('complementary', { name: 'Workspace details' })).toBeHidden();
  const graph = page.getByRole('group', { name: 'Workspace knowledge graph' });
  await expect(graph).toBeVisible();
  await expect(page.locator('.graph-ledger dt').filter({ hasText: /^Notes$/u })).toBeVisible();
  await expect(page.locator('.graph-ledger dt').filter({ hasText: /^Wikilinks$/u })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Graph documents' })).toContainText('First look');
  await page.getByRole('searchbox', { name: 'Search graph artifacts' }).fill('First look');
  await expect(
    page.getByRole('list', { name: 'Graph documents' }).getByRole('listitem'),
  ).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search graph artifacts' }).fill('');
  await expect(page.getByText(/6 artifacts · \d+ connections/u)).toBeVisible();

  const hub = graph.getByRole('button', { name: /AI Fundamentals, overview, \d+ wikilinks, hub/u });
  await expect(hub).toHaveClass(/hub/u);

  const focusedNode = graph.getByRole('button').first();
  await focusedNode.focus();
  await expect(focusedNode).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(focusedNode).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.selection-action').getByRole('button')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.keyboard.press('Escape');
  await expect(focusedNode).toHaveAttribute('aria-pressed', 'false');

  await page
    .getByRole('list', { name: 'Graph documents' })
    .getByRole('button', { name: /First look/u })
    .click();
  await expect(page.getByRole('heading', { name: 'First look at AI Fundamentals' })).toBeVisible();
});

test('a wikilink in a rendered document opens what it names', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  const sheet = page.locator('.note-sheet');
  const openOverview = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Graph' }).click();
    await page
      .getByRole('list', { name: 'Graph documents' })
      .getByRole('button', { name: 'AI Fundamentals overview', exact: true })
      .click();
    await expect(sheet.getByRole('heading', { name: 'AI Fundamentals' })).toBeVisible();
  };

  await openOverview();
  await sheet.getByRole('link', { name: 'First look' }).click();
  await expect(page.getByRole('heading', { name: 'First look at AI Fundamentals' })).toBeVisible();

  // The sheet delegates clicks, so a link must still work from the keyboard alone.
  await openOverview();
  await sheet.getByRole('link', { name: 'roadmap' }).focus();
  await page.keyboard.press('Enter');
  await expect(sheet).toContainText('Establish the terms and boundaries.');
});

test('graph view zooms, adjusts forces, and remembers the sliders', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Graph' }).click();
  const svg = page.locator('svg.constellation');
  await expect(svg).toBeVisible();
  await expect(svg).toHaveAttribute('viewBox', /.+/u);
  const fitted = await svg.getAttribute('viewBox');

  await page.getByRole('button', { name: 'View controls' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomed = await svg.getAttribute('viewBox');
  expect(zoomed).not.toBe(fitted);

  await page.getByLabel('Link length').fill('220');
  await page.getByLabel('Spacing').fill('0.9');
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Knowledge constellation' })).toBeVisible();
  await page.getByRole('button', { name: 'View controls' }).click();
  await expect(page.getByLabel('Link length')).toHaveValue('220');
  await expect(page.getByLabel('Spacing')).toHaveValue('0.9');

  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Fit view' }).click();
  await expect(svg).toHaveAttribute('viewBox', /.+/u);
});

test('insights derives an honest local analytics snapshot', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addPastedSource(page);

  await page.getByRole('button', { name: 'Insights' }).click();
  await expect(page.getByRole('heading', { name: 'Your learning has a shape.' })).toBeVisible();
  await expect(page.getByText('Approved sources', { exact: true })).toBeVisible();
  await expect(page.getByText('Artifacts connected', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Activity recorded over the past 14 days' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where evidence is forming' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Most linked artifacts' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Source mix' })).toBeVisible();
  await expect(page.getByText(/does not estimate study time or invent a score/u)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('graph nodes pin where dropped, filter by kind, and color by topic', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Graph' }).click();
  const graph = page.getByRole('group', { name: 'Workspace knowledge graph' });
  await expect(graph).toBeVisible();
  await page.getByRole('button', { name: 'View controls' }).click();
  // Scoped: the artifact finder beside the stage has its own same-named kind buttons.
  const showOnGraph = page.getByRole('group', { name: 'Show on the graph' });

  // A keyboard nudge is the accessible equivalent of dragging, and it pins too.
  const releasePins = page.getByRole('button', { name: 'Release pins' });
  await expect(releasePins).toBeDisabled();
  const note = graph.getByRole('button', { name: /First look/u });
  const noteCircle = note.locator('circle').first();
  const beforeX = await noteCircle.getAttribute('cx');
  await note.focus();
  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }
  await expect(noteCircle).not.toHaveAttribute('cx', beforeX ?? '');
  await expect(releasePins).toBeEnabled();
  // The nudged node keeps its seat instead of drifting back like Obsidian's.
  const pinnedX = await noteCircle.getAttribute('cx');
  await page.waitForTimeout(400);
  await expect(noteCircle).toHaveAttribute('cx', pinnedX ?? '');
  await releasePins.click();
  await expect(releasePins).toBeDisabled();

  const documents = page.getByRole('list', { name: 'Graph documents' });
  const beforeCount = await documents.getByRole('button').count();
  await showOnGraph.getByRole('button', { name: 'Notes', exact: true }).click();
  expect(await documents.getByRole('button').count()).toBeLessThan(beforeCount);
  await expect(graph.getByRole('button', { name: /First look/u })).toHaveCount(0);
  // Structure survives every filter so the constellation never empties out.
  await expect(graph.getByRole('button', { name: /AI Fundamentals, overview/u })).toBeVisible();
  await showOnGraph.getByRole('button', { name: 'Notes', exact: true }).click();
  expect(await documents.getByRole('button').count()).toBe(beforeCount);

  await page.getByLabel('Color by').selectOption('topic');
  await expect(page.getByRole('list', { name: 'Topic colors' })).toContainText('ai-fundamentals');
  await expect(
    graph
      .getByRole('button', { name: /AI Fundamentals, overview/u })
      .locator('circle')
      .first(),
  ).toHaveAttribute('fill', /oklch/u);
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await page.getByRole('button', { name: 'View controls' }).click();
  await expect(page.getByLabel('Color by')).toHaveValue('topic');
});

test('a workspace can grow past its first topic', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'New topic' }).click();
  await expect(page.getByRole('heading', { name: 'Open another line of inquiry.' })).toBeVisible();
  await page.getByLabel('Topic name').fill('Distributed Systems Consensus Protocols in Practice');
  await page.getByRole('button', { name: 'Create topic' }).click();

  const rail = page.getByRole('navigation', { name: 'Workspace' });
  await expect(rail.getByRole('button', { name: 'AI Fundamentals' })).toBeVisible();
  await expect(
    rail.getByRole('button', { name: 'Distributed Systems Consensus Protocols in Practice' }),
  ).toBeVisible();

  // A long topic name truncates inside the rail instead of spilling across the canvas.
  const railBox = (await rail.boundingBox())!;
  const longTopic = (await rail
    .getByRole('button', { name: 'Distributed Systems Consensus Protocols in Practice' })
    .boundingBox())!;
  expect(longTopic.x + longTopic.width).toBeLessThanOrEqual(railBox.x + railBox.width + 1);

  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.locator('.today-ledger')).toContainText('2');
  await expectNoSeriousA11yViolations(page);
});

test('closing the inspector keeps unsaved drafts and the open view survives reload', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await previewCurriculum(page);

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const outline = page.getByLabel('Outline text');
  await expect(outline).not.toHaveValue('');

  // Every one of these used to unmount the inspector and destroy the pasted outline.
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await page.getByRole('button', { name: 'Graph' }).click();
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await expect(page.getByLabel('Outline text')).toHaveValue(/Skills measured/u);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Knowledge constellation' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('graph');
});

test('the conflict proof brings its proposal on screen', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await page.getByRole('button', { name: 'Today' }).click();
  await runConflictProof(page);

  // Run from Today, the proof still lands on the note it protected, with the decision in view.
  const accept = page.getByRole('button', { name: 'Accept this proposal' });
  await expect(accept).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Review the proposal' })).toBeVisible();

  await accept.click();
  await expect(page.getByRole('heading', { name: 'Proposed next step' })).toBeVisible();
});

test('creates, edits, and conflict-protects a Markdown note', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openInspector(page);

  await page.getByLabel('New note title').fill('Evidence map');
  await page.getByRole('button', { name: 'Create note' }).click();
  await expect(page.getByRole('heading', { name: 'Edit note' })).toBeVisible();
  const editor = page.getByLabel('Markdown note');
  await editor.fill(
    `# Evidence map\n\nDusori draft with [[../Sources/items/example|one source]].\n\n\`\`\`\nconst attention = ${unbreakableToken};\n\`\`\`\n`,
  );

  await page.evaluate(async (token) => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topic = await (
      await root.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const notes = await topic.getDirectoryHandle('Notes');
    const handle = await notes.getFileHandle('evidence-map.md');
    const writable = await handle.createWritable();
    await writable.write(
      `# Evidence map\n\nExternal editor wins until I review the proposal: ${token}\n`,
    );
    await writable.close();
  }, unbreakableToken);

  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your external edit stayed untouched.' }),
  ).toBeVisible();
  await expect(
    page.getByText('External editor wins until I review the proposal').first(),
  ).toBeVisible();
  // The diff is on screen and overflowing here; the assertion after acceptance
  // would only see the rendered note.
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Accept this proposal' }).click();
  await expect(page.getByText('Dusori draft with')).toBeVisible();
  await expect(page.locator('.markdown pre')).toContainText(unbreakableToken);
  await expectNoSeriousA11yViolations(page);
});

test('searches local workspace prose and opens the matching document', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addPastedSource(page);
  await openInspector(page);

  await page.getByLabel('Words to find').fill('each token weigh');
  await page.getByRole('button', { name: 'Search local workspace' }).click();

  const results = page.getByRole('list', { name: 'Workspace search results' });
  await expect(results).toContainText('Transformer notes');
  await expect(results).toContainText('each token weigh the other tokens');
  await results.getByRole('button', { name: /Transformer notes/u }).click();
  await expect(page.locator('article')).toContainText(
    'Attention lets each token weigh the other tokens in its context.',
  );
  await expect(page.locator('.path-label')).toContainText('/Sources/items/');
  await expectNoSeriousA11yViolations(page);
});

test('filters workspace search by a tag written in the source itself', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openResearch(page);
  await page.getByLabel('Source title').fill('Tagged attention notes');
  await page
    .getByLabel('Source text')
    .fill('Attention weighs tokens against each other. Filed under #attention today.');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Tagged attention notes',
  );
  await openInspector(page);

  await page.getByLabel('Words to find').fill('tag:attention');
  await page.getByRole('button', { name: 'Search local workspace' }).click();

  const results = page.getByRole('list', { name: 'Workspace search results' });
  await expect(results).toContainText('Tagged attention notes');
  await expect(results).toContainText('#attention');

  // A tag nothing carries returns nothing rather than falling back to a text match.
  await page.getByLabel('Words to find').fill('tag:absent');
  await page.getByRole('button', { name: 'Search local workspace' }).click();
  await expect(page.getByText('No local documents contain every search word.')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

/** Reads one workspace file straight from OPFS, to prove what was and was not written. */
async function readWorkspaceFile(page: Page, path: string): Promise<string> {
  return page.evaluate(async (target) => {
    const origin = await navigator.storage.getDirectory();
    let directory = await origin.getDirectoryHandle('Dusori');
    const segments = target.split('/');
    const name = segments.pop() as string;
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
    return (await (await directory.getFileHandle(name)).getFile()).text();
  }, path);
}

/** PDF strings are parenthesised, so a literal parenthesis or backslash must be escaped. */
function escapePdfText(text: string): string {
  return text.replace(/([\\()])/gu, '\\$1');
}

/**
 * A real, minimal PDF, so the import path is exercised end to end. Each line is drawn at its own
 * offset, which is what makes pdfjs report the line breaks an outline parser needs. Passing no
 * text produces a structurally valid page with an empty content stream — what a scan looks like
 * to a reader. Text is encoded latin1, so `·` reads back as a bullet and `•` would not survive.
 */
function samplePdf(text: string | readonly string[]): Buffer {
  const lines = (typeof text === 'string' ? [text] : text).filter((line) => line.trim());
  const stream = lines.length
    ? `BT /F1 12 Tf 40 740 Td ${lines
        .map((line, index) => `${index === 0 ? '' : '0 -16 Td '}(${escapePdfText(line)}) Tj`)
        .join(' ')} ET`
    : '';
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test('imports a PDF by reading its text on this device', async ({ page }) => {
  const sentence = 'Positional encoding restores order before the first attention block.';
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openResearch(page);

  await page.getByLabel('Source type').selectOption('file');
  await page.getByLabel('Source title').fill('Encoding handout');
  await page.getByRole('button', { name: 'Choose a local file' }).setInputFiles({
    buffer: samplePdf(sentence),
    mimeType: 'application/pdf',
    name: 'encoding-handout.pdf',
  });
  await page.getByRole('button', { name: 'Add source' }).click();

  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('Encoding handout');
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('Local file');

  // The extracted text is an ordinary local source, searchable like any other.
  await openInspector(page);
  await page.getByLabel('Words to find').fill('positional encoding restores');
  await page.getByRole('button', { name: 'Search local workspace' }).click();
  await expect(page.getByRole('list', { name: 'Workspace search results' })).toContainText(
    'Encoding handout',
  );
  await expectNoSeriousA11yViolations(page);
});

test('a PDF with no text layer says so instead of saving an empty source', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openResearch(page);

  await page.getByLabel('Source type').selectOption('file');
  await page.getByLabel('Source title').fill('Scanned pages');
  await page.getByRole('button', { name: 'Choose a local file' }).setInputFiles({
    buffer: samplePdf(''),
    mimeType: 'application/pdf',
    name: 'scanned-pages.pdf',
  });
  await page.getByRole('button', { name: 'Add source' }).click();

  await expect(page.getByRole('alert')).toContainText('no extractable text');
  await expect(page.getByRole('alert')).toContainText('ships no OCR');
  // Nothing was written, so the topic still has no source list at all.
  await expect(page.getByRole('list', { name: 'Saved sources' })).toHaveCount(0);
});

test('editing learning preferences shows a diff and writes only on acceptance', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openInspector(page);

  const tutor = page.getByRole('region', { name: 'Learning preferences' });
  await expect(tutor).toContainText('Topics/ai-fundamentals/TUTOR.md');
  await expect(tutor).toContainText('Prefer concrete examples before abstractions.');

  await tutor
    .getByLabel('New learning preference')
    .fill('Always name the source before the claim.');
  await tutor.getByRole('button', { name: 'Add' }).click();

  // Nothing is written until the diff is accepted.
  await expect(tutor).toContainText('Proposed change');
  await expect(tutor).toContainText('+ - Always name the source before the claim.');
  const beforeAccept = await readWorkspaceFile(page, 'Topics/ai-fundamentals/TUTOR.md');
  expect(beforeAccept).not.toContain('Always name the source before the claim.');

  await tutor.getByRole('button', { name: 'Accept and save' }).click();
  await expect(tutor).toContainText('Learning preferences saved');

  const afterAccept = await readWorkspaceFile(page, 'Topics/ai-fundamentals/TUTOR.md');
  expect(afterAccept).toContain('Always name the source before the claim.');
  expect(afterAccept).toContain('Prefer concrete examples before abstractions.');
  await expectNoSeriousA11yViolations(page);
});

test('shows unresolved links and backlinks from the same local graph', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openInspector(page);

  await page.getByLabel('New note title').fill('Link map');
  await page.getByRole('button', { name: 'Create note' }).click();
  await page
    .getByLabel('Markdown note')
    .fill('# Link map\n\nSee [[001-first-look]] and [[Missing reference]].\n');
  await page.getByRole('button', { name: 'Save note' }).click();

  const refresh = page.getByRole('button', { name: 'Refresh workspace health' });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(page.getByRole('list', { name: 'Workspace health issues' })).toContainText(
    'Missing reference',
  );
  await expect(page.getByText('1 issue', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'AI Fundamentals' }).click();
  const backlinks = page.getByRole('list', { name: 'Backlinks to current document' });
  await expect(backlinks).toContainText('Link map');
  await backlinks.getByRole('button', { name: /Link map/u }).click();
  await expect(page.getByRole('heading', { name: 'Link map' })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('source library stores pasted text and URL references without remote fetching', async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://arxiv.org/')) remoteRequests.push(request.url());
  });

  await createBrowserWorkspace(page);
  await createTopic(page);
  await addPastedSource(page);

  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('Transformers paper');
  await page.getByLabel('Web address').fill('https://arxiv.org/abs/1706.03762');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('link', { name: 'Transformers paper' })).toHaveAttribute(
    'href',
    'https://arxiv.org/abs/1706.03762',
  );
  expect(remoteRequests).toEqual([]);

  const sourceState = await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topics = await root.getDirectoryHandle('Topics');
    const topic = await topics.getDirectoryHandle('ai-fundamentals');
    const sources = await topic.getDirectoryHandle('Sources');
    const manifest = JSON.parse(
      await (await sources.getFileHandle('manifest.json')).getFile().then((file) => file.text()),
    );
    const items = await sources.getDirectoryHandle('items');
    const itemNames: string[] = [];
    for await (const [name] of items.entries()) itemNames.push(name);
    const updates = await topic.getDirectoryHandle('Updates');
    const yearNames: string[] = [];
    for await (const [name] of updates.entries()) yearNames.push(name);
    return { itemNames: itemNames.sort(), manifest, yearNames };
  });

  expect(sourceState.manifest.sources).toHaveLength(2);
  expect(sourceState.manifest.sources).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: 'paste', title: 'Transformer notes' }),
      expect.objectContaining({ method: 'url', title: 'Transformers paper' }),
    ]),
  );
  expect(sourceState.itemNames).toHaveLength(2);
  expect(sourceState.yearNames).not.toEqual([]);

  await page.getByLabel('Source title').fill('Private file');
  await page.getByLabel('Web address').fill('file:///private/notes.txt');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Dusori stores only http:// or https:// URL references.',
  );
  await expectNoSeriousA11yViolations(page);
});

test('research requires disclosure, previews exact capture, and adds a graph source', async ({
  page,
}) => {
  let catalogRequests = 0;
  await page.route('https://learn.microsoft.com/api/catalog/**', async (route) => {
    catalogRequests += 1;
    await route.fulfill({ contentType: 'application/json', json: microsoftLearnCatalog });
  });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await expect(page.getByRole('heading', { name: 'Research' })).toBeVisible();
  await expect(page.getByLabel('Research objective')).toHaveValue('0');
  const runResearch = page.getByRole('button', { name: 'Scan for strong sources' });
  await expect(runResearch).toBeDisabled();

  const allowMicrosoftLearn = page.getByRole('button', { name: 'Allow Microsoft Learn' });
  await allowMicrosoftLearn.click();
  let disclosure = page.getByRole('dialog', { name: 'Allow Microsoft Learn search?' });
  await expect(disclosure).toContainText(
    'Searching downloads the public Microsoft Learn module catalog (learn.microsoft.com) over HTTPS and ranks it on this device. Nothing from your workspace is sent. Allow on this device?',
  );
  await disclosure.getByRole('button', { name: 'Keep search off' }).click();
  await expect(allowMicrosoftLearn).toBeFocused();
  expect(catalogRequests).toBe(0);

  await allowMicrosoftLearn.click();
  disclosure = page.getByRole('dialog', { name: 'Allow Microsoft Learn search?' });
  await disclosure.getByRole('button', { name: 'Allow search' }).click();
  // Topic creation arms one automatic run; granting the first provider consent starts it.
  await expect(page.getByText('Establish identity terms with Microsoft Entra')).toBeVisible();
  expect(catalogRequests).toBe(1);

  const result = page
    .getByRole('list', { name: 'Research shortlist' })
    .getByRole('listitem')
    .filter({ hasText: 'Establish identity terms with Microsoft Entra' });
  await result.getByRole('button', { name: 'Preview' }).click();
  let preview = page.getByRole('dialog', { name: 'Preview research source' });
  await expect(preview.getByText('Source markdown')).toBeVisible();
  // The raw capture sits in a collapsed <details>; expand it so the scrollable
  // <pre> is actually rendered when axe runs.
  await preview.getByText('Source markdown').click();
  await expect(preview.locator('pre')).toBeVisible();
  await expect(preview.locator('pre')).toContainText(
    '# Establish identity terms with Microsoft Entra',
  );
  await expect(preview.locator('pre')).toContainText('Filler line 60');
  await expectNoSeriousA11yViolations(page);
  await preview.getByRole('button', { name: 'Close preview', exact: true }).first().click();
  await expect(result.getByRole('button', { name: 'Preview' })).toBeFocused();

  await result.getByRole('button', { name: 'Preview' }).click();
  preview = page.getByRole('dialog', { name: 'Preview research source' });
  await preview.getByRole('button', { name: 'Add to sources' }).click();

  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Establish identity terms with Microsoft Entra',
  );
  expect(
    await page.evaluate(() => localStorage.getItem('dusori-research-consent:v2:mslearn')),
  ).toBe('allowed');
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Graph' }).click();
  await expect(page.getByRole('list', { name: 'Graph documents' })).toContainText(
    'Establish identity terms with Microsoft Entra',
  );
});

test('dismissed research suggestions stay gone after reload', async ({ page }) => {
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: wikipediaSearch });
  });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await page.getByRole('button', { name: 'Allow Wikipedia' }).click();
  const disclosure = page.getByRole('dialog', { name: 'Allow Wikipedia search?' });
  await disclosure.getByRole('button', { name: 'Allow search' }).click();
  const result = page
    .getByRole('list', { name: 'Research shortlist' })
    .getByRole('listitem')
    .filter({ hasText: 'Microsoft Entra Connect' });
  await result.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: 'Scan for strong sources' }).click();
  await expect(page.getByText('No new suggestions matched this objective.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeHidden();
});

test('a research run leaves a durable trail and a Today mission', async ({ page }) => {
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: wikipediaSearch });
  });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await page.getByRole('button', { name: 'Allow Wikipedia' }).click();
  await page
    .getByRole('dialog', { name: 'Allow Wikipedia search?' })
    .getByRole('button', { name: 'Allow search' })
    .click();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeVisible();

  const trail = page.getByRole('list', { name: 'Research trail runs' });
  await expect(trail).toContainText('Wikipedia');
  await expect(trail).toContainText('found 1');

  // The trail is workspace evidence, not screen state: it must survive a reload.
  await page.reload();
  await expect(page.getByRole('list', { name: 'Research trail runs' })).toContainText('found 1');
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Today' }).click();
  const missions = page.getByRole('list', { name: 'Research missions' });
  await expect(missions).toContainText('1 discovered');
  await expect(missions).toContainText('Refreshed today');
  await expectNoSeriousA11yViolations(page);
});

test('reading a saved source produces quoted passages, a synthesis, and a learning page', async ({
  page,
}) => {
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('prop') === 'extracts') {
      await route.fulfill({ contentType: 'application/json', json: wikipediaExtract });
      return;
    }
    await route.fulfill({ contentType: 'application/json', json: wikipediaSearch });
  });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await page.getByRole('button', { name: 'Allow Wikipedia' }).click();
  await page
    .getByRole('dialog', { name: 'Allow Wikipedia search?' })
    .getByRole('button', { name: 'Allow search' })
    .click();
  const result = page
    .getByRole('list', { name: 'Research shortlist' })
    .getByRole('listitem')
    .filter({ hasText: 'Microsoft Entra Connect' });
  await result.getByRole('button', { name: 'Preview' }).click();
  await page
    .getByRole('dialog', { name: 'Preview research source' })
    .getByRole('button', { name: 'Add to sources' })
    .click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Microsoft Entra Connect',
  );

  await page.getByRole('button', { name: 'Read saved sources' }).click();
  await expect(page.getByText('Read 1 source into')).toBeVisible();

  await page.getByRole('button', { name: 'Build synthesis' }).click();
  await expect(page.getByText('Synthesis written from')).toBeVisible();

  await page.getByRole('button', { name: 'Create learning page' }).click();
  await expect(page.getByText('Learning page built at')).toBeVisible();

  // Both artifacts are ordinary files in the portable tree, and the page needs no network.
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const read = async (path: string): Promise<string> => {
      const parts = path.split('/');
      let dir = root;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      return (await (await dir.getFileHandle(parts.at(-1)!)).getFile()).text();
    };
    const base = 'Dusori/Topics/ai-fundamentals/';
    return {
      learn: await read(`${base}Learning/learn.html`),
      synthesis: await read(`${base}Synthesis.md`),
    };
  });
  expect(files.synthesis).toContain('generated: synthesis');
  expect(files.synthesis).toContain('Every line below is quoted from a source you approved.');
  expect(files.learn.startsWith('<!doctype html>')).toBe(true);
  expect(files.learn).not.toMatch(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)=/iu);
  // The stored file stays theme-neutral so it follows the reader's own preference elsewhere.
  expect(files.learn).toContain('<html lang="en">');
  await expectNoSeriousA11yViolations(page);

  // The page is viewable inside Dusori, but only from a sandbox that cannot reach the app.
  await page.getByRole('button', { name: 'Open learning page' }).click();
  const frameElement = page.locator('iframe[title^="Learning page"]');
  await expect(frameElement).toHaveAttribute('sandbox', 'allow-scripts');
  const sandbox = await frameElement.getAttribute('sandbox');
  expect(sandbox).not.toContain('allow-same-origin');

  // Its content really renders, and its check-yourself prompts really work.
  const learnFrame = page.frameLocator('iframe[title^="Learning page"]');
  await expect(
    learnFrame.getByRole('heading', { name: 'AI Fundamentals', level: 1 }),
  ).toBeVisible();
  await expect(
    learnFrame.getByText('Every passage links back to where it came from.'),
  ).toBeVisible();
  const firstCheck = learnFrame.locator('details.check').first();
  await expect(firstCheck).toHaveJSProperty('open', false);
  await learnFrame.getByRole('button', { name: 'Reveal every answer' }).click();
  await expect(firstCheck).toHaveJSProperty('open', true);
});

test('an armed topic refreshes itself on open only once it is stale', async ({ page }) => {
  let searches = 0;
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    searches += 1;
    await route.fulfill({ contentType: 'application/json', json: wikipediaSearch });
  });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await page.getByRole('button', { name: 'Allow Wikipedia' }).click();
  await page
    .getByRole('dialog', { name: 'Allow Wikipedia search?' })
    .getByRole('button', { name: 'Allow search' })
    .click();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeVisible();
  expect(searches).toBe(1);

  // Reloading a fresh topic must not re-scan, armed or not. The checkbox surviving the
  // reload is also what proves the standing permission reached the workspace file.
  const keepFresh = page.getByRole('checkbox', { name: /Keep this topic fresh/u });
  await keepFresh.check();
  // The control re-enables only once the workspace file holds the answer.
  await expect(keepFresh).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('list', { name: 'Research trail runs' })).toBeVisible();
  await expect(keepFresh).toBeChecked();
  expect(searches).toBe(1);

  // Age the recorded run past the window; opening the topic then refreshes it exactly once.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const topics = await dusori.getDirectoryHandle('Topics');
    const topic = await topics.getDirectoryHandle('ai-fundamentals');
    const handle = await topic.getFileHandle('research.json');
    const parsed = JSON.parse(await (await handle.getFile()).text());
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    parsed.lastRunAt = old;
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(parsed, null, 2));
    await writable.close();
  });

  await page.reload();
  await expect(page.getByText(/Refreshed on open because this topic/u)).toBeVisible();
  expect(searches).toBe(2);
});

test('an all-provider failure stays distinct from a completed search with no matches', async ({
  page,
}) => {
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.abort('internetdisconnected');
  });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await page.getByRole('button', { name: 'Allow Wikipedia' }).click();
  await page
    .getByRole('dialog', { name: 'Allow Wikipedia search?' })
    .getByRole('button', { name: 'Allow search' })
    .click();

  await expect(page.getByText('The allowed providers could not complete this scan.')).toBeVisible();
  await expect(page.getByText('No new suggestions matched this objective.')).toBeHidden();
  const retry = page.getByRole('button', { name: 'Retry scan' });
  await expect(retry).toBeVisible();
  await expect(page.getByText('No suggestions were returned or saved.')).toBeVisible();

  await page.unroute('https://en.wikipedia.org/w/api.php**');
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: wikipediaSearch });
  });
  await retry.click();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeVisible();
  await expect(page.getByText('The allowed providers could not complete this scan.')).toBeHidden();
});

// The unit test reads the policy out of `app.html`; this one proves the browser agrees on the
// artifact that actually ships. Each origin is stubbed with a permissive CORS reply, so an
// allowed probe is answered locally and nothing leaves the machine. The content-security-policy
// is enforced ahead of the network stack, so a forbidden origin never reaches its route and is
// the only way a probe can fail.
test('the shipped policy lets every browser-called provider origin through', async ({ page }) => {
  const origins = [...new Set(createResearchProviders().flatMap((provider) => provider.origins))];
  expect(origins.length).toBeGreaterThan(0);
  for (const origin of origins) {
    await page.route(`${origin}/**`, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        json: {},
      });
    });
  }

  await page.goto('/Dusori/app/');
  const blocked = await page.evaluate(async (list: string[]) => {
    const results = await Promise.all(
      list.map(async (origin) =>
        fetch(`${origin}/csp-probe`).then(
          () => null,
          () => origin,
        ),
      ),
    );
    return results.filter((origin) => origin !== null);
  }, origins);

  expect(blocked).toEqual([]);
});

test('curriculum import previews official objectives, applies explicitly, and never fetches', async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://learn.microsoft.com/'))
      remoteRequests.push(request.url());
  });

  await createBrowserWorkspace(page);
  await createTopic(page);
  await previewCurriculum(page);
  await expectNoSeriousA11yViolations(page);
  expect(remoteRequests).toEqual([]);

  await page.getByRole('button', { name: 'Apply roadmap' }).click();
  await expect(page.locator('.learning-loop')).toContainText(
    'Describe responsible AI considerations',
  );
  await openResearch(page);
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'AI-901 official study guide',
  );
  await expectNoSeriousA11yViolations(page);

  const files = await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topics = await root.getDirectoryHandle('Topics');
    const topic = await topics.getDirectoryHandle('ai-fundamentals');
    const roadmap = await (await topic.getFileHandle('roadmap.md')).getFile();
    const sources = await topic.getDirectoryHandle('Sources');
    const manifest = await (await sources.getFileHandle('manifest.json')).getFile();
    return { manifest: await manifest.text(), roadmap: await roadmap.text() };
  });
  expect(files.roadmap).toContain('origin: imported-curriculum');
  expect(files.manifest).toContain('AI-901 official study guide');
});

test('curriculum import recognizes AWS exam guide text pasted from the PDF', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  if (!(await page.getByRole('heading', { name: 'Curriculum' }).isVisible())) {
    await page.getByRole('button', { name: 'Open inspector' }).click();
  }
  await page.getByRole('button', { name: 'Import curriculum' }).click();
  await page.getByLabel('Source title').last().fill('SAA-C03 exam guide');
  await page
    .getByLabel('Official page')
    .fill('https://aws.amazon.com/certification/certified-solutions-architect-associate/');
  await page.getByLabel('Outline text').fill(awsExamGuide);
  await page.getByRole('button', { name: 'Preview roadmap' }).click();

  await expect(page.getByText('AWS Certification exam guide', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '9 roadmap items' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Curriculum preview' })).toContainText(
    'Design Secure Architectures (30%)',
  );
  await expect(page.getByRole('list', { name: 'Curriculum preview' })).toContainText(
    'Design secure workloads and applications',
  );
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Apply roadmap' }).click();
  await expect(page.locator('.learning-loop')).toContainText('Design Secure Architectures');
  await expect(page.getByRole('heading', { name: 'Curriculum ready.' })).toBeVisible();
});

test('curriculum import reads an AWS exam guide straight from its PDF', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  if (!(await page.getByRole('heading', { name: 'Curriculum' }).isVisible())) {
    await page.getByRole('button', { name: 'Open inspector' }).click();
  }
  await page.getByRole('button', { name: 'Import curriculum' }).click();

  // The same outline the paste journey uses, delivered as a PDF. `·` is what latin1 can carry,
  // and pdfjs reads it back as the bullet the adapter already knows.
  await page.getByLabel('Exam guide PDF').setInputFiles({
    buffer: samplePdf(awsExamGuide.replace(/•/gu, '·').split('\n')),
    mimeType: 'application/pdf',
    name: 'saa-c03-exam-guide.pdf',
  });

  // The filename seeds the title, and the extracted text is editable before previewing.
  await expect(page.getByLabel('Source title').last()).toHaveValue('saa-c03-exam-guide');
  await expect(page.getByLabel('Outline text')).toHaveValue(/Task Statement 1\.1/u);

  await page.getByRole('button', { name: 'Preview roadmap' }).click();

  await expect(page.getByText('AWS Certification exam guide', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '9 roadmap items' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Curriculum preview' })).toContainText(
    'Design Secure Architectures (30%)',
  );
  await expect(page.getByRole('list', { name: 'Curriculum preview' })).toContainText(
    'Design secure workloads and applications',
  );
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Apply roadmap' }).click();
  await expect(page.locator('.learning-loop')).toContainText('Design Secure Architectures');
  await expect(page.getByRole('heading', { name: 'Curriculum ready.' })).toBeVisible();
});

test('curriculum import explains invalid URLs and unstructured input before writing', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  if (!(await page.getByRole('heading', { name: 'Curriculum' }).isVisible())) {
    await page.getByRole('button', { name: 'Open inspector' }).click();
  }
  await page.getByRole('button', { name: 'Import curriculum' }).click();
  await page.getByLabel('Source title').last().fill('Course outline');
  await page.getByLabel('Official page').fill('file:///private/course.md');
  await page.getByLabel('Outline text').fill('# Course\n- First skill\n- Second skill');
  await page.getByRole('button', { name: 'Preview roadmap' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Curriculum sources must use an http:// or https:// address.',
  );

  await page.getByLabel('Official page').fill('');
  await page.getByLabel('Outline text').fill('A paragraph without headings or list items.');
  await page.getByRole('button', { name: 'Preview roadmap' }).click();
  await expect(page.getByRole('alert')).toContainText('Dusori could not recognize this outline.');
  await expect(page.getByRole('alert')).toContainText('AWS exam guide');
  await expectNoSeriousA11yViolations(page);

  const roadmap = await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topics = await root.getDirectoryHandle('Topics');
    const topic = await topics.getDirectoryHandle('ai-fundamentals');
    return (await (await topic.getFileHandle('roadmap.md')).getFile()).text();
  });
  expect(await roadmap).toContain('Import a curriculum when you want a structured outline');
});

test('curriculum import preserves an externally edited roadmap until explicit replacement', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topics = await root.getDirectoryHandle('Topics');
    const topic = await topics.getDirectoryHandle('ai-fundamentals');
    const handle = await topic.getFileHandle('roadmap.md');
    const writable = await handle.createWritable();
    await writable.write('# My external roadmap\n\nKeep this direction.\n');
    await writable.close();
  });

  await previewCurriculum(page);
  await page.getByRole('button', { name: 'Apply roadmap' }).click();
  await expect(page.getByRole('heading', { name: 'The existing roadmap changed.' })).toBeVisible();

  const externalRoadmap = await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topic = await (
      await root.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    return (await (await topic.getFileHandle('roadmap.md')).getFile()).text();
  });
  expect(await externalRoadmap).toContain('Keep this direction.');

  await page.getByRole('button', { name: 'Use imported roadmap' }).click();
  await expect(page.locator('.learning-loop')).toContainText(
    'Identify AI concepts and capabilities',
  );
  await expectNoSeriousA11yViolations(page);
});

test('export and replacement import preserve the rendered workspace', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addPastedSource(page);
  await applyCurriculum(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace' }).click();
  const download = await downloadPromise;
  const archive = await download.path();
  expect(archive).not.toBeNull();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain(
      'Replace this browser workspace with “My learning workspace”?',
    );
    expect(dialog.message()).toContain('1 topic');
    expect(dialog.message()).toMatch(/\d+ files/u);
    expect(dialog.message()).toContain('validated before this confirmation');
    dialog.accept();
  });
  await page.locator('aside input[type="file"]').setInputFiles(archive!);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await openResearch(page);
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Transformer notes',
  );
  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await expect(page.locator('.learning-loop')).toContainText(
    'Identify AI concepts and capabilities',
  );
  await openInspector(page);
  await expect(page.getByText('Workspace validated and imported safely.')).toBeVisible();
});

test('learning loop persists roadmap progress, topic status, and Today activity', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  const firstObjective = page.getByLabel('Establish the terms and boundaries.');
  await firstObjective.check();
  await expect(firstObjective).toBeChecked();
  await expect(page.getByText('33%', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Paused' }).click();
  await expect(page.getByRole('button', { name: 'Paused' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(
    page
      .getByRole('article')
      .getByText('Explain the central mechanism in your own words.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Workspace recap' })).toContainText(
    'Paused this topic.',
  );
  await expect(page.getByRole('list', { name: 'Continue learning' })).toContainText(
    'Explain the central mechanism in your own words.',
  );
  // A topic with an empty manifest says so, rather than reporting sources it could not read.
  await expect(page.getByRole('list', { name: 'Continue learning' })).toContainText(
    'no sources yet',
  );
  await expect(page.getByRole('list', { name: 'Workspace recap' })).toContainText(
    'Completed “Establish the terms and boundaries.”',
  );
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Workspace recap' })).toContainText(
    'Paused this topic.',
  );
  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await expect(page.getByLabel('Establish the terms and boundaries.')).toBeChecked();
  await expect(page.getByRole('button', { name: 'Paused' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const persisted = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const roadmap = await (await topic.getFileHandle('roadmap.md')).getFile();
    const state = await (await topic.getFileHandle('state.json')).getFile();
    return { roadmap: await roadmap.text(), state: JSON.parse(await state.text()) };
  });
  expect(persisted.roadmap).toContain('- [x] Establish the terms and boundaries.');
  expect(persisted.state.status).toBe('paused');
});

test('a topic is paused and resumed from its Today card', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  // Each card names its own topic, so three identical labels never collide.
  const card = page.getByRole('group', { name: 'Topic status — AI Fundamentals' });
  await expect(card.getByRole('button', { name: 'Active — AI Fundamentals' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectNoSeriousA11yViolations(page);

  await card.getByRole('button', { name: 'Paused — AI Fundamentals' }).click();
  await expect(page.getByText('“AI Fundamentals” paused.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Paused — AI Fundamentals' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('list', { name: 'Workspace recap' })).toContainText(
    'Paused this topic.',
  );

  await card.getByRole('button', { name: 'Active — AI Fundamentals' }).click();
  await expect(page.getByText('“AI Fundamentals” resumed.')).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const state = await (await topic.getFileHandle('state.json')).getFile();
    return JSON.parse(await state.text()) as { status: string };
  });
  expect(persisted.status).toBe('active');
});

test('learning loop protects an externally edited roadmap before accepting progress', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topic = await (
      await root.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const handle = await topic.getFileHandle('roadmap.md');
    const current = await (await handle.getFile()).text();
    const writable = await handle.createWritable();
    await writable.write(`${current.trimEnd()}\n\nExternal planning note.\n`);
    await writable.close();
  });

  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await page.getByLabel('Establish the terms and boundaries.').check();
  await expect(
    page.getByRole('heading', { name: 'The roadmap changed outside Dusori.' }),
  ).toBeVisible();

  const beforeAccept = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Dusori');
    const topic = await (
      await root.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    return (await (await topic.getFileHandle('roadmap.md')).getFile()).text();
  });
  expect(await beforeAccept).toContain('External planning note.');
  expect(await beforeAccept).toContain('- [ ] Establish the terms and boundaries.');

  await page.getByRole('button', { name: 'Use this progress choice' }).click();
  await expect(page.getByLabel('Establish the terms and boundaries.')).toBeChecked();
  const afterAccept = await page.evaluate(async () => {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('Dusori');
    const topic = await (
      await root.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    return (await (await topic.getFileHandle('roadmap.md')).getFile()).text();
  });
  expect(await afterAccept).toContain('External planning note.');
  expect(await afterAccept).toContain('- [x] Establish the terms and boundaries.');
  await expectNoSeriousA11yViolations(page);
});

test('an overflowing roadmap proposal diff stays reachable by keyboard', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  // A proposal diff always shows just the toggled line, so the scroll region
  // overflows on title length rather than row count.
  await page.evaluate(async (title) => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topic = await (
      await root.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const handle = await topic.getFileHandle('roadmap.md');
    const current = await (await handle.getFile()).text();
    const writable = await handle.createWritable();
    await writable.write(`${current.trimEnd()}\n- [ ] ${title}\n`);
    await writable.close();
  }, longObjectiveTitle);

  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await page.getByLabel(longObjectiveTitle).check();

  const proposal = page.getByRole('region', { name: 'Progress proposal changes' });
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText(longObjectiveTitle);
  expect(await proposal.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );

  await proposal.focus();
  await expect(proposal).toBeFocused();
  await expectNoSeriousA11yViolations(page);
});

test('a source-grounded review walks local evidence before the schedule moves', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addReviewSource(page);

  await openTodayView(page);
  const start = page.getByRole('button', {
    name: 'Start review — AI Fundamentals',
  });
  await start.click();

  // One source with two headed sections: explain, a cloze, one prompt per section, then compare.
  // No locate prompt, because a single source leaves nothing to tell apart.
  const session = page.getByRole('dialog', { name: 'AI Fundamentals' });
  await expect(session).toContainText('Prompt 1 of 5');
  await expect(session).toContainText('in your own words before revealing the source');
  await expect(session).toContainText('Deterministic prompt');
  // The excerpt stays hidden until the learner has tried to answer.
  await expect(session.getByRole('region', { name: 'Source excerpt' })).toBeHidden();
  await expect(session).toContainText('Your answers stay in this session unless you save them');

  await session.getByRole('button', { name: 'Reveal the source' }).click();
  const excerpt = session.getByRole('region', { name: 'Source excerpt' });
  await expect(excerpt).toContainText('Attention lets each token weigh');
  await expect(session).toContainText('Attention notes');
  await expect(session).toContainText('Topics/ai-fundamentals/Sources/items/');
  await expectNoSeriousA11yViolations(page);

  await session.getByRole('button', { name: 'Next' }).click();
  await expect(session).toContainText('Prompt 2 of 5');
  await expect(session).toContainText('Fill the blank');
  await session.getByRole('button', { name: 'Next' }).click();
  await expect(session).toContainText('contribute to');
  for (let step = 0; step < 2; step += 1) {
    await session.getByRole('button', { name: 'Next' }).click();
  }
  await expect(session).toContainText('Prompt 5 of 5');
  await expect(session.getByRole('button', { name: 'Next' })).toBeDisabled();
  await expect(session).toContainText('Only this choice changes your review schedule.');

  await session.getByRole('button', { name: 'Got it' }).click();
  await expect(session).toBeHidden();
  await expect(page.getByText('Reviewed “AI Fundamentals”. The next review is')).toBeVisible();
  await expect(
    page.getByText('Nothing needs continuing now. “AI Fundamentals” returns on'),
  ).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const review = await (await topic.getFileHandle('review.json')).getFile();
    return JSON.parse(await review.text()) as { dueOn: string; repetition: number };
  });
  expect(persisted.repetition).toBe(0);
});

test('typed review answers are kept only when the learner saves them as a note', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addReviewSource(page);
  await openTodayView(page);

  const start = page.getByRole('button', {
    name: 'Start review — AI Fundamentals',
  });
  await start.click();
  const session = page.getByRole('dialog', { name: 'AI Fundamentals' });

  // Typing then leaving must not silently drop the answer.
  await session.getByLabel('Your answer').fill('Attention mixes every token in the window.');
  await session.getByRole('button', { name: 'Close without rating' }).click();
  await expect(session).toContainText('Your answers are only in this session.');
  await session.getByRole('button', { name: 'Continue without saving' }).click();
  await expect(session).toBeHidden();
  expect(await noteNames(page)).toEqual(['001-first-look.md']);

  await start.click();
  await session.getByLabel('Your answer').fill('Attention mixes every token in the window.');
  await session.getByRole('button', { name: 'Next' }).click();
  await session.getByLabel('Your answer').fill('It explains where the weights come from.');
  await session.getByRole('button', { name: 'Save answers as a note' }).click();
  await expect(session).toContainText('Saved to Topics/ai-fundamentals/Notes/');
  await expectNoSeriousA11yViolations(page);

  // Saved, so leaving no longer asks.
  await session.getByRole('button', { name: 'Close without rating' }).click();
  await expect(session).toBeHidden();

  const note = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const notes = await (
      await (await dusori.getDirectoryHandle('Topics')).getDirectoryHandle('ai-fundamentals')
    ).getDirectoryHandle('Notes');
    for await (const [name, handle] of notes.entries()) {
      if (name.startsWith('review-answers') && handle.kind === 'file') {
        return (await (handle as FileSystemFileHandle).getFile()).text();
      }
    }
    return '';
  });
  expect(note).toContain('Attention mixes every token in the window.');
  expect(note).toContain('It explains where the weights come from.');
  expect(note).toContain('The prompts below were generated by Dusori');
  expect(note).toContain('Deterministic prompt');
  expect(note).toContain('Topics/ai-fundamentals/Sources/items/');
  // The learner's answers are their own writing, so the note is not marked generated.
  expect(note).not.toContain('generated:');
});

test('starting and abandoning a review session changes nothing', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addReviewSource(page);

  await openTodayView(page);
  const start = page.getByRole('button', {
    name: 'Start review — AI Fundamentals',
  });

  // Keyboard only: reach the session, reveal evidence, leave, and land back on the invoker.
  await start.focus();
  await page.keyboard.press('Enter');
  const session = page.getByRole('dialog', { name: 'AI Fundamentals' });
  await expect(session).toBeVisible();
  await expect(session.getByRole('button', { name: 'Close review session' })).toBeFocused();
  await session.getByRole('button', { name: 'Reveal the source' }).click();
  await expect(session.getByRole('region', { name: 'Source excerpt' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(session).toBeHidden();
  await expect(start).toBeFocused();

  await start.click();
  await page.getByRole('button', { name: 'Close without rating' }).click();
  await expect(page.getByRole('dialog', { name: 'AI Fundamentals' })).toBeHidden();

  await expect(page.getByRole('list', { name: 'Continue learning' })).toContainText(
    'AI Fundamentals',
  );
  const reviewFileExists = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    return topic
      .getFileHandle('review.json')
      .then(() => true)
      .catch(() => false);
  });
  expect(reviewFileExists).toBe(false);
});

test('Today routes a URL-only objective back to Research without fetching it', async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://arxiv.org/')) remoteRequests.push(request.url());
  });
  await createBrowserWorkspace(page);
  await createTopic(page);

  await openResearch(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('Transformers paper');
  await page.getByLabel('Web address').fill('https://arxiv.org/abs/1706.03762');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('link', { name: 'Transformers paper' })).toBeVisible();

  await openTodayView(page);
  const research = page.getByRole('button', { name: 'Research objective — AI Fundamentals' });
  await expect(research).toBeVisible();
  await research.click();
  await expect(page.getByRole('heading', { name: 'Sources' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'AI Fundamentals' })).toBeHidden();
  expect(remoteRequests).toEqual([]);
  await expectNoSeriousA11yViolations(page);
});

test('a review session keeps its decisions hit-testable at supported phone sizes', async ({
  browser,
}) => {
  for (const [width, height] of [
    [320, 720],
    [375, 812],
    [414, 896],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await createBrowserWorkspace(page);
    await createTopic(page);
    await addReviewSource(page);

    await openTodayView(page);
    await page.getByRole('button', { name: 'Start review — AI Fundamentals' }).click();
    const session = page.getByRole('dialog', { name: 'AI Fundamentals' });
    await session.getByRole('button', { name: 'Reveal the source' }).click();
    await expect(session.getByRole('region', { name: 'Source excerpt' })).toBeVisible();
    const next = session.getByRole('button', { name: 'Next' });
    await expectHitTestable(next, `Next at ${width}×${height}`);
    // The last prompt carries the widest footer: rating pair, trust line, and the way out.
    for (let step = 0; step < 4; step += 1) {
      await expectHitTestable(next, `Next on prompt ${step + 1} at ${width}×${height}`);
      await next.click();
    }
    await expect(session).toContainText('Prompt 5 of 5');

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `horizontal overflow at ${width}px`).toBe(
      dimensions.clientWidth,
    );
    const gotIt = session.getByRole('button', { name: 'Got it' });
    await expectHitTestable(gotIt, `Got it at ${width}×${height}`);
    await context.close();
  }
});

test('spaced review schedules a topic and explains the resting queue', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addReviewSource(page);

  await openTodayView(page);
  await expect(page.getByRole('list', { name: 'Continue learning' })).toContainText(
    'AI Fundamentals',
  );

  await page.getByRole('button', { name: 'Start review — AI Fundamentals' }).click();
  await reachLastReviewPrompt(page);
  await page
    .getByRole('dialog', { name: 'AI Fundamentals' })
    .getByRole('button', { name: 'Got it' })
    .click();
  await expect(page.getByText('Reviewed “AI Fundamentals”. The next review is')).toBeVisible();
  await expect(
    page.getByText('Nothing needs continuing now. “AI Fundamentals” returns on'),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Workspace recap' })).toContainText(
    'Reviewed this topic; the next review is',
  );
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(
    page.getByText('Nothing needs continuing now. “AI Fundamentals” returns on'),
  ).toBeVisible();

  const persisted = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dusori = await root.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const review = await (await topic.getFileHandle('review.json')).getFile();
    return JSON.parse(await review.text()) as {
      dueOn: string;
      repetition: number;
      schemaVersion: number;
    };
  });
  expect(persisted.schemaVersion).toBe(1);
  expect(persisted.repetition).toBe(0);
  expect(persisted.dueOn >= new Date().toISOString().slice(0, 10)).toBe(true);
});

test('curriculum preview remains usable without horizontal overflow at supported narrow widths', async ({
  browser,
}) => {
  for (const width of [320, 375, 414, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await createBrowserWorkspace(page);
    await createTopic(page);
    await previewCurriculum(page);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `horizontal overflow at ${width}px`).toBe(
      dimensions.clientWidth,
    );
    const applyButton = page.getByRole('button', { name: 'Apply roadmap' });
    expect(await applyButton.evaluate((button) => button.getClientRects().length)).toBe(1);
    await context.close();
  }
});

test('Today and Roadmap remain usable without overflow at supported narrow widths', async ({
  browser,
}) => {
  for (const width of [320, 375, 414, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await createBrowserWorkspace(page);
    await createTopic(page);
    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    let dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `Today overflow at ${width}px`).toBe(dimensions.clientWidth);

    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
    await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
    await expect(page.getByLabel('Establish the terms and boundaries.')).toBeVisible();
    dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `Roadmap overflow at ${width}px`).toBe(dimensions.clientWidth);
    await context.close();
  }
});

test('the installed shell reloads and remains usable offline', async ({ page, context }) => {
  await createBrowserWorkspace(page);
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'What do you want to understand?' }),
  ).toBeVisible();
  await createTopic(page);
  await expect(page.getByRole('heading', { name: 'First look at AI Fundamentals' })).toBeVisible();
});

// Reloading the bare app URL only ever exercised the one navigation key the shell happens to be
// cached under. The app writes ?topic= and ?view= itself on every topic and view change, so the
// URL a returning reader actually reopens carries a query the cache lookup has to tolerate.
test('the installed shell reopens offline at the view it remembered', async ({ page, context }) => {
  await createBrowserWorkspace(page);
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await createTopic(page, { remainInResearch: true });
  expect(new URL(page.url()).search).toContain('topic=ai-fundamentals');

  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Let the strongest evidence find you.' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
});

test('manifest and service-worker paths honor the single project base', async ({ request }) => {
  const manifest = await request.get('/Dusori/app/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({
    start_url: '/Dusori/app/',
    scope: '/Dusori/app/',
  });
  expect((await request.get('/Dusori/app/service-worker.js')).ok()).toBe(true);
});

test('mobile workspace drawers are fully keyboard operable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/Dusori/app/');
  await page.getByRole('button', { name: 'Create workspace' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'What do you want to understand?' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open workspace navigation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();

  // Being visible is not the same as being reachable. The drawer covers the canvas, so focus has
  // to move into it and stay there; otherwise Tab walks through the controls hidden behind it.
  // Scoped to the drawer: the dismiss backdrop carries the same accessible name.
  const drawer = page.getByRole('navigation', { name: 'Workspace' });
  await expect(drawer.getByRole('button', { name: 'Close workspace navigation' })).toBeFocused();
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('nav.rail'))),
      'focus left the open drawer',
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open workspace navigation' })).toBeFocused();

  await page.getByRole('button', { name: 'Open inspector' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Workspace details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Workspace details' })).toBeHidden();
});

test('captures the required responsive product surfaces', async ({ browser }) => {
  test.setTimeout(60_000);
  await mkdir('test-results/screenshots', { recursive: true });

  for (const width of [375, 1280]) {
    const context: BrowserContext = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 900 },
    });
    const page = await context.newPage();

    await page.goto('/Dusori/');
    await page.screenshot({
      path: `test-results/screenshots/landing-${width}.png`,
      fullPage: true,
    });

    await createBrowserWorkspace(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await page.screenshot({
      path: `test-results/screenshots/workspace-${width}.png`,
      fullPage: true,
    });

    await createTopic(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await page.screenshot({
      path: `test-results/screenshots/note-${width}.png`,
      fullPage: true,
    });

    await addPastedSource(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await page.screenshot({
      path: `test-results/screenshots/sources-${width}.png`,
      fullPage: true,
    });

    await previewCurriculum(page);
    await page.screenshot({
      path: `test-results/screenshots/curriculum-${width}.png`,
      fullPage: true,
    });
    if (width === 1280) {
      await page.locator('.curriculum-importer').screenshot({
        path: 'test-results/screenshots/curriculum-panel-1280.png',
      });
    }

    await runConflictProof(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await page.screenshot({
      path: `test-results/screenshots/conflict-${width}.png`,
      fullPage: true,
    });
    await context.close();
  }

  const siteContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const sitePage = await siteContext.newPage();
  await createBrowserWorkspace(sitePage);
  await createTopic(sitePage);
  await addPastedSource(sitePage);
  await applyCurriculum(sitePage);
  await sitePage.getByLabel('Describe generative AI concepts').check();
  await sitePage.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(sitePage.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
  await sitePage.screenshot({ path: 'test-results/screenshots/site-workspace-1440.png' });
  await siteContext.close();
});

const attentionFetchedPage = {
  fetchedAt: '2026-07-21T00:00:00.000Z',
  finalUrl: 'https://example.org/attention',
  text: `Attention lets each token weigh the other tokens in its context.\n${overflowingLines}`,
  title: 'Attention in transformers',
  truncated: false,
};

async function routeCompanionFetch(page: Page): Promise<void> {
  await page.route('**/api/health', async (route) => {
    await route.fulfill({ json: companionHealth });
  });
  await page.route('**/api/research/fetch', async (route) => {
    await route.fulfill({ json: attentionFetchedPage });
  });
}

// Adds a URL source, then reloads with a companion token the way a browser
// pointed at `npx @udhawan97/dusori`'s printed URL would. The reload relies on the same
// OPFS-survives-reload behavior as "dismissed research suggestions stay gone
// after reload" below (onMount re-reads dusori.json and reopens the first
// topic on every load, so a plain page.goto with a token is enough -- no
// extra re-selection step is needed). The source list is asserted visible
// right after, so a broken reload fails here rather than later.
async function addUrlSourceAndConnectCompanion(
  page: Page,
  title: string,
  url: string,
): Promise<void> {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openResearch(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill(title);
  await page.getByLabel('Web address').fill(url);
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(title);

  await page.goto('/Dusori/app/?token=e2e-companion-token');
  await expect(page.getByText('Connected for this session')).toBeVisible();
  await openResearch(page);
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(title);
}

test.describe('companion flows', () => {
  // The PWA service worker owns same-origin fetches, which prevents Playwright
  // request fixtures from observing the companion calls. Offline behavior has
  // its own test; companion transport tests deliberately exercise the page path.
  test.use({ serviceWorkers: 'block' });

  test('companion fetch upgrades a URL source after a per-fetch confirm', async ({ page }) => {
    const fetchCalls: string[] = [];
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    await page.route('**/api/research/fetch', async (route) => {
      fetchCalls.push(route.request().headers()['authorization'] ?? '');
      await route.fulfill({ json: attentionFetchedPage });
    });

    await createBrowserWorkspace(page);
    await createTopic(page);
    await openResearch(page);

    await page.getByLabel('Source type').selectOption('url');
    await page.getByLabel('Source title').fill('Attention paper');
    await page.getByLabel('Web address').fill('https://example.org/attention');
    await page.getByRole('button', { name: 'Add source' }).click();
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
      'Attention paper',
    );

    // Without a companion token the upgrade action is absent and the hint shows.
    await expect(page.getByRole('button', { name: 'Fetch full content' })).toHaveCount(0);
    await expect(
      page.getByText('Run the companion (npx @udhawan97/dusori) to fetch full page content.'),
    ).toBeVisible();

    // Reload as if served by the companion.
    await page.goto('/Dusori/app/?token=e2e-companion-token');
    await expect(page.getByText('Connected for this session')).toBeVisible();
    await openResearch(page);
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
      'Attention paper',
    );

    const fetchButton = page.getByRole('button', { name: 'Fetch full content' });
    await fetchButton.click();
    const confirm = page.getByRole('dialog', { name: 'Fetch full page content?' });
    await expect(confirm).toContainText('example.org');
    await expect(confirm).toContainText('https://example.org/attention');
    await confirm.getByRole('button', { name: 'Keep reference only' }).click();
    expect(fetchCalls).toHaveLength(0);

    await fetchButton.click();
    await page
      .getByRole('dialog', { name: 'Fetch full page content?' })
      .getByRole('button', { name: 'Fetch page' })
      .click();
    const preview = page.getByRole('dialog', { name: 'Preview fetched content' });
    await expect(preview.locator('pre')).toContainText('weigh the other tokens');
    await expect(preview.locator('pre')).toContainText('# Attention paper');
    await expect(preview.locator('pre')).toContainText('Filler line 60');
    // The overflowing preview is only on screen until the replace lands.
    await expectNoSeriousA11yViolations(page);
    await preview.getByRole('button', { name: 'Replace content' }).click();

    await expect(
      page.getByText('Source upgraded to full page content and recorded in the update log.'),
    ).toBeVisible();
    expect(fetchCalls).toEqual(['Bearer e2e-companion-token']);
    await expectNoSeriousA11yViolations(page);
  });

  test('a failed replace stays visible inside the still-open preview dialog', async ({ page }) => {
    await routeCompanionFetch(page);
    await addUrlSourceAndConnectCompanion(page, 'Attention paper', 'https://example.org/attention');

    await page.getByRole('button', { name: 'Fetch full content' }).click();
    await page
      .getByRole('dialog', { name: 'Fetch full page content?' })
      .getByRole('button', { name: 'Fetch page' })
      .click();
    const preview = page.getByRole('dialog', { name: 'Preview fetched content' });
    await expect(preview.locator('pre')).toContainText('weigh the other tokens');

    // Simulate an external edit to the source's own file between preview and
    // replace. SourceLibrary captures the file's hash the moment the preview
    // opens (its `expectedContentHash`); upgradeSource re-reads the file at
    // replace time and throws StorageConflictError the instant the hash no
    // longer matches -- this is the same guard the "learning loop protects an
    // externally edited roadmap" test exercises for roadmap.md, applied here to
    // a source item file.
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dusori = await root.getDirectoryHandle('Dusori');
      const topic = await (
        await dusori.getDirectoryHandle('Topics')
      ).getDirectoryHandle('ai-fundamentals');
      const items = await (await topic.getDirectoryHandle('Sources')).getDirectoryHandle('items');
      const names: string[] = [];
      for await (const [name] of items.entries()) names.push(name);
      const handle = await items.getFileHandle(names[0]);
      const writable = await handle.createWritable();
      await writable.write('Edited outside Dusori while the preview was open.');
      await writable.close();
    });

    await preview.getByRole('button', { name: 'Replace content' }).click();

    // The dialog must stay open, and the conflict sentence must render *inside*
    // it. Scoping the locator to `preview` (rather than `page`) means this
    // assertion fails if a regression instead renders the message only in the
    // page behind the modal backdrop -- the exact "invisible failed replace"
    // defect this suite exists to catch.
    await expect(preview).toBeVisible();
    await expect(
      preview.getByText('This source changed outside Dusori. Review the file, then try again.'),
    ).toBeVisible();
    await expect(
      page.getByText('Source upgraded to full page content and recorded in the update log.'),
    ).toHaveCount(0);
  });

  test('companion launch credentials are consumed and health proves the service contract', async ({
    page,
  }) => {
    await createBrowserWorkspace(page);
    await createTopic(page);
    const appOrigin = new URL(page.url()).origin;

    await page.route('**/api/health', async (route) => {
      await route.fulfill({ body: '<html>static fallback</html>', contentType: 'text/html' });
    });
    await page.goto(
      `/Dusori/app/?token=visible-secret&companion=${encodeURIComponent(appOrigin)}&topic=ai-fundamentals&view=graph`,
    );
    await openInspector(page);
    await expect(page.getByText('Connection was denied. Allow local-network access')).toBeVisible();
    expect(page.url()).not.toContain('token=');
    expect(page.url()).not.toContain('companion=');
    expect(page.url()).toContain('topic=ai-fundamentals');
    expect(page.url()).toContain('view=graph');

    await page.unroute('**/api/health');
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    await page.goto(
      `/Dusori/app/?token=e2e-companion-token&companion=${encodeURIComponent(appOrigin)}`,
    );
    await expect(page.getByText('Connected for this session')).toBeVisible();
    expect(page.url()).not.toContain('token=');
    expect(page.url()).not.toContain('companion=');
  });

  test('source confirm and preview dialogs contain focus and restore it on close', async ({
    page,
  }) => {
    await routeCompanionFetch(page);
    await addUrlSourceAndConnectCompanion(page, 'Attention paper', 'https://example.org/attention');

    const fetchButton = page.getByRole('button', { name: 'Fetch full content' });
    await fetchButton.click();
    const confirm = page.getByRole('dialog', { name: 'Fetch full page content?' });
    const confirmFetchPage = confirm.getByRole('button', { name: 'Fetch page' });
    const confirmKeepReference = confirm.getByRole('button', { name: 'Keep reference only' });
    await expect(confirmFetchPage).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(confirmKeepReference).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirmFetchPage).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(fetchButton).toBeFocused();

    await fetchButton.click();
    await confirm.getByRole('button', { name: 'Fetch page' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview fetched content' });
    const previewKeepStub = preview.getByRole('button', { name: 'Keep the stub' });
    const previewReplace = preview.getByRole('button', { name: 'Replace content' });
    await expect(previewKeepStub).toBeFocused();

    // The scrollable capture is a tab stop of its own, so a keyboard user can
    // reach and scroll it before deciding.
    await page.keyboard.press('Tab');
    await expect(preview.getByRole('region', { name: 'Source markdown' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(previewReplace).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(preview).toBeHidden();
    await expect(fetchButton).toBeFocused();
  });

  test('a captioned video becomes a readable source without the browser calling Google', async ({
    page,
  }) => {
    const googleRequests: string[] = [];
    page.on('request', (request) => {
      const host = new URL(request.url()).host;
      if (/youtube\.com|ytimg\.com|googlevideo\.com|google\.com/u.test(host)) {
        googleRequests.push(request.url());
      }
    });
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    await page.route('**/api/research/youtube?**', async (route) => {
      await route.fulfill({
        json: {
          results: [
            {
              author: 'Computerphile',
              id: 'dQw4w9WgXcQ',
              lengthSeconds: 934,
              publishedAt: '2023-11-14',
              summary: 'A walk through attention.',
              title: 'How attention works',
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              viewCount: 1_200_000,
            },
          ],
        },
      });
    });
    await page.route('**/api/research/youtube-transcript**', async (route) => {
      await route.fulfill({
        json: {
          label: 'English (auto-generated)',
          text: `Attention lets each token weigh every other token in its context window.\n${overflowingLines}`,
        },
      });
    });
    await page.route('**/api/research/youtube-thumbnail**', async (route) => {
      await route.fulfill({
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
        contentType: 'image/png',
      });
    });

    await createBrowserWorkspace(page);
    await createTopic(page);
    await page.goto('/Dusori/app/?token=e2e-companion-token');
    await expect(page.getByText('Connected for this session')).toBeVisible();
    await openResearch(page);

    await page.getByRole('button', { name: 'Allow YouTube' }).click();
    const disclosure = page.getByRole('dialog', { name: 'Allow YouTube search?' });
    await expect(disclosure).toContainText('Invidious instance you configured');
    await expect(disclosure).toContainText('never contacts YouTube or Google');
    await disclosure.getByRole('button', { name: 'Allow search' }).click();
    await page.getByRole('button', { name: 'Scan for strong sources' }).click();

    const result = page
      .getByRole('list', { name: 'Research shortlist' })
      .getByRole('listitem')
      .filter({ hasText: 'How attention works' });
    await expect(result).toContainText('Video');
    await expect(result).toContainText('Computerphile · 1.2M views · 15:34');
    // Visibility alone would also pass on a broken image showing its alt text.
    const thumbnail = result.getByRole('img', { name: 'Thumbnail for How attention works' });
    await expect(thumbnail).toBeVisible();
    expect(
      await thumbnail.evaluate((image) => ({
        decoded: (image as HTMLImageElement).naturalWidth > 0,
        fromBlob: (image as HTMLImageElement).src.startsWith('blob:'),
      })),
    ).toEqual({ decoded: true, fromBlob: true });

    await result.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview research source' });
    await expect(preview).toContainText('Attention lets each token weigh every other token');
    await expect(preview).toContainText('often machine-generated');
    await preview.getByRole('button', { name: 'Add to sources' }).click();
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
      'How attention works',
    );

    const captured = await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const dusori = await root.getDirectoryHandle('Dusori');
      const sources = await (
        await (await dusori.getDirectoryHandle('Topics')).getDirectoryHandle('ai-fundamentals')
      ).getDirectoryHandle('Sources');
      const manifest = JSON.parse(
        await (await sources.getFileHandle('manifest.json')).getFile().then((file) => file.text()),
      ) as { sources: { origin?: { capturedVia: string; provider: string }; path?: string }[] };
      const record = manifest.sources.at(-1);
      const items = await sources.getDirectoryHandle('items');
      let text = '';
      for await (const [name, handle] of items.entries()) {
        if (record?.path?.endsWith(name)) {
          text = await (await (handle as FileSystemFileHandle).getFile()).text();
        }
      }
      return { origin: record?.origin, text };
    });
    expect(captured.origin).toMatchObject({
      capturedVia: 'youtube-transcript',
      provider: 'youtube',
    });
    expect(captured.text).toContain('## Transcript');
    expect(captured.text).toContain('Attention lets each token weigh every other token');
    expect(captured.text).toContain('Original URL: <https://www.youtube.com/watch?v=dQw4w9WgXcQ>');
    // The whole point of proxying: no Google-owned host is ever contacted by the browser.
    expect(googleRequests).toEqual([]);
    await expectNoSeriousA11yViolations(page);
  });

  test('synthesis prose is written by the model and the document survives its failure', async ({
    page,
  }) => {
    const synthesisRequests: string[] = [];
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    await page.route('**/api/ai/capabilities', async (route) => {
      await route.fulfill({ json: { providers: [{ id: 'ollama', model: 'gemma3:4b' }] } });
    });
    await page.route('**/api/ai/synthesize', async (route) => {
      synthesisRequests.push(route.request().postData() ?? '');
      await route.fulfill({
        json: { overview: 'Attention is the mechanism these passages keep returning to.' },
      });
    });

    await createBrowserWorkspace(page);
    await createTopic(page);
    await addReviewSource(page);
    await page.goto('/Dusori/app/?token=e2e-companion-token');
    await expect(page.getByText('Connected for this session')).toBeVisible();
    await page.goto('/Dusori/app/?token=e2e-companion-token&topic=ai-fundamentals&view=research');

    await page.getByRole('button', { name: 'Read saved sources' }).click();
    // A plain string, not a regex: the notice wraps across lines and only string matching
    // normalizes that whitespace.
    await expect(page.getByText('Read 1 source into')).toBeVisible();

    // Prose is off until this device allows the AI scope, so the first build stays deterministic.
    await page.getByRole('button', { name: 'Build synthesis' }).click();
    await expect(page.getByText('Synthesis written from')).toBeVisible();
    expect(synthesisRequests).toEqual([]);

    await page.getByRole('button', { name: /Allow AI ranking · gemma3:4b/u }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Allow search' }).click();

    await page.getByRole('button', { name: 'Build synthesis' }).click();
    await expect(page.getByText('Synthesis written from')).toBeVisible();
    expect(synthesisRequests).toHaveLength(1);

    // Only the topic and the passages already quoted in the workspace are sent.
    const sent = JSON.parse(synthesisRequests[0] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['claims', 'topic']);
    expect(synthesisRequests[0]).not.toContain('Topics/');

    const withProse = await readWorkspaceFile(page, 'Topics/ai-fundamentals/Synthesis.md');
    expect(withProse).toContain('Attention is the mechanism these passages keep returning to.');
    // The document names its author and still says the evidence is not the model's.
    expect(withProse).toContain('written by gemma3:4b');
    expect(withProse).toContain('not from the model');

    // A failing model must cost the prose and nothing else.
    await page.unroute('**/api/ai/synthesize');
    await page.route('**/api/ai/synthesize', async (route) => {
      await route.fulfill({ json: { error: 'no', reason: 'ai-failed' }, status: 502 });
    });
    await page.getByRole('button', { name: 'Build synthesis' }).click();
    await expect(page.getByText('AI was unavailable, so the synthesis quotes')).toBeVisible();

    const withoutProse = await readWorkspaceFile(page, 'Topics/ai-fundamentals/Synthesis.md');
    expect(withoutProse).not.toContain('Attention is the mechanism these passages keep');
    expect(withoutProse).not.toContain('written by gemma3:4b');
    expect(withoutProse).toContain('Every line below is quoted from a source you approved.');
  });

  test('sharper review prompts need their own consent and fall back to the templates', async ({
    page,
  }) => {
    const promptRequests: string[] = [];
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    await page.route('**/api/ai/capabilities', async (route) => {
      await route.fulfill({ json: { providers: [{ id: 'ollama', model: 'gemma3:4b' }] } });
    });
    await page.route('**/api/ai/recall-prompts', async (route) => {
      promptRequests.push(route.request().postData() ?? '');
      await route.fulfill({
        json: {
          // One per deterministic prompt: a reply with any other count is rejected on purpose.
          prompts: [
            'Say what attention does before you look.',
            'Which word completes the sentence you were shown?',
            'Why do weights matter here?',
            'What breaks without positional encoding?',
            'What did your answer leave out?',
          ],
        },
      });
    });

    await createBrowserWorkspace(page);
    await createTopic(page);
    await addReviewSource(page);
    await page.goto('/Dusori/app/?token=e2e-companion-token');
    await expect(page.getByText('Connected for this session')).toBeVisible();

    await openTodayView(page);
    await page.getByRole('button', { name: 'Start review — AI Fundamentals' }).click();
    const session = page.getByRole('dialog', { name: 'AI Fundamentals' });

    // Consent for AI ranking does not carry over: this scope asks for itself.
    await expect(session).toContainText('Deterministic prompt');
    expect(promptRequests).toEqual([]);
    await session.getByRole('button', { name: 'Allow sharper prompts · gemma3:4b' }).click();
    await expect(session).toContainText('up to four short excerpts');
    await session.getByRole('button', { name: 'Allow sharper prompts', exact: true }).click();

    await expect(session).toContainText('Say what attention does before you look.');
    await expect(session).toContainText('Written by gemma3:4b · unverified');
    expect(promptRequests).toHaveLength(1);
    const sent = JSON.parse(promptRequests[0] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['excerpts', 'objective']);
    expect(promptRequests[0]).not.toContain('Topics/');
    // Evidence still comes from the local file, not from the model.
    await session.getByRole('button', { name: 'Reveal the source' }).click();
    await expect(session).toContainText('Topics/ai-fundamentals/Sources/items/');
    await session.getByRole('button', { name: 'Close without rating' }).click();

    await page.unroute('**/api/ai/recall-prompts');
    await page.route('**/api/ai/recall-prompts', async (route) => {
      await route.fulfill({ json: { error: 'no', reason: 'ai-failed' }, status: 502 });
    });
    await page.getByRole('button', { name: 'Start review — AI Fundamentals' }).click();
    await expect(session).toContainText('Sharper prompts were unavailable');
    await expect(session).toContainText('in your own words before revealing the source');
    await expect(session).toContainText('Deterministic prompt');
    await expectNoSeriousA11yViolations(page);
  });
});

test('the Obsidian guide is modal and restores focus to its opener', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/Dusori/app/');
  const opener = page.getByRole('button', { name: 'Use Dusori with Obsidian' });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Connect only a Dusori folder.' });
  const close = dialog.getByRole('button', { name: 'Close Obsidian guide' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Select my Dusori folder' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

/**
 * A control the reader cannot see is a control they do not have. `toBeVisible` passes for anything
 * rendered below the fold, so these assertions compare the control's own box against the viewport.
 */
async function expectWithinFold(page: Page, locator: Locator, what: string): Promise<void> {
  const box = await locator.boundingBox();
  const height = page.viewportSize()?.height ?? 0;
  expect(box, `${what} was not rendered`).not.toBeNull();
  expect(
    Math.round(box!.y + box!.height),
    `${what} ends below the ${height}px fold`,
  ).toBeLessThanOrEqual(height);
}

async function expectHitTestable(locator: Locator, what: string): Promise<void> {
  const result = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const hit = document.elementFromPoint(center.x, center.y);
    const dialogRect = element.closest('dialog')?.getBoundingClientRect();
    return {
      hit: hit === element || element.contains(hit),
      insideDialog: dialogRect
        ? rect.top >= dialogRect.top && rect.bottom <= dialogRect.bottom
        : false,
      insideViewport:
        rect.left >= 0 &&
        rect.right <= document.documentElement.clientWidth &&
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight,
    };
  });
  expect(result, `${what} is not fully visible and hit-testable`).toEqual({
    hit: true,
    insideDialog: true,
    insideViewport: true,
  });
}

test('the first run offers a workspace without scrolling', async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1512, 850],
    [375, 812],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('/Dusori/app/');
    await expectWithinFold(
      page,
      page.getByRole('button', { name: 'Create workspace' }),
      `Create workspace at ${width}x${height}`,
    );
  }
});

test('the research view the app opens on shows its first control at desktop and phone sizes', async ({
  browser,
}) => {
  for (const [width, height] of [
    [1440, 900],
    [375, 812],
    [320, 720],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await createBrowserWorkspace(page);
    await createTopic(page, { remainInResearch: true });

    await expectWithinFold(page, page.getByText('Research objective'), 'the research objective');
    await expectWithinFold(
      page,
      page.getByRole('button', { name: 'Allow Wikipedia' }),
      `the first provider control at ${width}×${height}`,
    );

    // The creation toast lands over that same region now. It announces; it must not absorb a click.
    await expect(page.getByText('Topic created.')).toBeVisible();
    await page.getByRole('button', { name: 'Allow GitHub' }).click();
    await expect(page.getByRole('dialog', { name: /Allow GitHub/u })).toBeVisible();
    await context.close();
  }
});

test('a user-requested mobile view change resets scroll and focuses its heading', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await createBrowserWorkspace(page);
  await expect(
    page.getByRole('heading', { name: 'What do you want to understand?' }),
  ).toBeFocused();
  await createTopic(page, { remainInResearch: true });
  await expect(
    page.getByRole('heading', { name: 'Let the strongest evidence find you.' }),
  ).toBeFocused();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Open workspace navigation' }).click();
  await page
    .getByRole('navigation', { name: 'Workspace' })
    .getByRole('button', { name: 'Today', exact: true })
    .click();

  const heading = page.getByRole('heading', { name: 'Today' });
  await expect(heading).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const placement = await page.evaluate(() => {
    const bar = document.querySelector('.canvas-bar')?.getBoundingClientRect();
    const title = document.querySelector('.learning-loop h1')?.getBoundingClientRect();
    return { barBottom: Math.round(bar?.bottom ?? 0), titleTop: Math.round(title?.top ?? 0) };
  });
  expect(placement.titleTop).toBeGreaterThanOrEqual(placement.barBottom);
});

test('the topic form starts empty and waits for a name', async ({ page }) => {
  await createBrowserWorkspace(page);

  const field = page.getByLabel('Topic name');
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('placeholder', /\S/u);
  await expect(page.getByRole('button', { name: 'Create topic' })).toBeDisabled();

  await field.fill('AI Fundamentals');
  await expect(page.getByRole('button', { name: 'Create topic' })).toBeEnabled();
});

test('the workspace rail reports connectivity as it changes', async ({ page, context }) => {
  await createBrowserWorkspace(page);
  const rail = page.getByRole('navigation', { name: 'Workspace' });
  await expect(rail).toContainText('Online · local data');

  await context.setOffline(true);
  await expect(rail).toContainText('Offline · ready');

  await context.setOffline(false);
  await expect(rail).toContainText('Online · local data');
});

test('a long topic name truncates its label without crushing its icon', async ({ page }) => {
  await createBrowserWorkspace(page);
  await page
    .getByLabel('Topic name')
    .fill('Byzantine Fault Tolerant Consensus Under Partial Synchrony and Adversarial Scheduling');
  await page.getByRole('button', { name: 'Create topic' }).click();
  await expect(
    page.getByRole('heading', { name: 'Let the strongest evidence find you.' }),
  ).toBeVisible();

  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('.rail .topic-list .rail-link')].map((link) => {
      const label = link.querySelector('.rail-link-label');
      return {
        iconWidth: Math.round(link.querySelector('svg')?.getBoundingClientRect().width ?? 0),
        truncated: label ? label.scrollWidth > label.clientWidth : false,
      };
    }),
  );

  expect(icons.length).toBeGreaterThan(0);
  expect(icons.some((icon) => icon.truncated)).toBe(true);
  for (const icon of icons) expect(icon.iconWidth).toBeGreaterThanOrEqual(16);
});

test('the disabled research scan names the permission it is waiting for', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  const scan = page.getByRole('button', { name: 'Scan for strong sources' });
  await expect(scan).toBeDisabled();
  const describedBy = await scan.getAttribute('aria-describedby');
  expect(describedBy, 'the disabled scan has no accessible description').toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toContainText(/allow at least one provider/iu);

  // Allowing a provider goes through its disclosure dialog; the description clears once it lands.
  await page.getByRole('button', { name: 'Allow Wikipedia' }).click();
  await page
    .getByRole('dialog', { name: /Allow Wikipedia/u })
    .getByRole('button', { name: /^Allow/u })
    .click();
  await expect(scan).toBeEnabled();
  await expect(scan).not.toHaveAttribute('aria-describedby', /./u);
});

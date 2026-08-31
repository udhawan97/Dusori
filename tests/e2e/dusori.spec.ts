import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { researchProviderPolicy } from '@dusori/core';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';

import { parseSourceAnnotationMetadata } from '../../apps/app/src/lib/source-reading';

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

const companionResearchCapabilities = {
  providers: [
    { available: true, id: 'arxiv', mode: 'keyless' },
    { available: true, id: 'mslearn', mode: 'keyless' },
    { available: true, id: 'websearch', mode: 'searxng' },
    { available: true, id: 'youtube', mode: 'metadata-reference-only' },
    { available: true, id: 'reddit', mode: 'oauth' },
  ],
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

async function makeOpfsUnavailable(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'getDirectory', {
      configurable: true,
      value: async () => {
        throw new DOMException(
          'The operation failed for an unknown transient reason.',
          'UnknownError',
        );
      },
    });
  });
}

async function createTopic(
  page: Page,
  options: { remainInResearch?: boolean } = {},
): Promise<void> {
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  const providerChoices = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await expect(providerChoices).toBeVisible();
  await providerChoices.getByRole('button', { name: 'Decide later' }).click();
  await expect(providerChoices).toBeHidden();
  if (options.remainInResearch) return;
  await openTodayView(page);
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
  if (await page.getByRole('heading', { name: 'Start with a direction.' }).isVisible()) return;
  const workspaceNavigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  const navigationButton = page.getByRole('button', { name: 'Open workspace navigation' });
  await expect
    .poll(
      async () => (await workspaceNavigation.isVisible()) || (await navigationButton.isVisible()),
    )
    .toBe(true);
  if (!(await workspaceNavigation.isVisible())) await navigationButton.click();
  await workspaceNavigation.getByRole('button', { name: 'Research', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
}

async function openSources(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { name: 'Sources', exact: true });
  const workspaceNavigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  const navigationButton = page.getByRole('button', { name: 'Open workspace navigation' });
  if (!(await heading.isVisible())) {
    await expect
      .poll(
        async () => (await workspaceNavigation.isVisible()) || (await navigationButton.isVisible()),
      )
      .toBe(true);
    if (!(await workspaceNavigation.isVisible())) await navigationButton.click();
    await workspaceNavigation.getByRole('button', { name: /^Sources/u }).click();
  }
  await expect(heading).toBeVisible();
  const addDetails = page.locator('details.add-source-details');
  if ((await addDetails.getAttribute('open')) === null) {
    await addDetails.getByText('Add your own source', { exact: true }).click();
  }
}

async function openDepthMap(page: Page): Promise<void> {
  const workspaceNavigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  const navigationButton = page.getByRole('button', { name: 'Open workspace navigation' });
  await expect
    .poll(
      async () => (await workspaceNavigation.isVisible()) || (await navigationButton.isVisible()),
    )
    .toBe(true);
  if (!(await workspaceNavigation.isVisible())) await navigationButton.click();
  await workspaceNavigation.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: 'Depth map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Research map' })).toBeVisible();
}

async function addPastedSource(page: Page): Promise<void> {
  await openSources(page);
  await page.getByLabel('Source title').fill('Transformer notes');
  await page
    .getByLabel('Source text')
    .fill('Attention lets each token weigh the other tokens in its context.');
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(
    page.getByText('Source added to this topic. The activity log was updated.').first(),
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

/** Reaches the optional learning tools from any width. */
async function openTodayView(page: Page): Promise<void> {
  const providerChoices = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  if (await providerChoices.isVisible()) {
    await providerChoices.getByRole('button', { name: 'Decide later' }).click();
  }
  const inspector = page.getByRole('complementary', { name: 'Workspace details' });
  if (await inspector.isVisible()) {
    await inspector.getByRole('button', { name: 'Close workspace details' }).click();
  }
  const workspaceNavigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  const navigationButton = page.getByRole('button', { name: 'Open workspace navigation' });
  // A reload briefly renders the workspace-restoring screen. Wait for the responsive shell to
  // choose either its wide navigation or its narrow drawer trigger before deciding which path to
  // use; an immediate visibility probe can mistake that loading frame for the mobile layout.
  await expect
    .poll(
      async () => (await workspaceNavigation.isVisible()) || (await navigationButton.isVisible()),
    )
    .toBe(true);
  if (!(await workspaceNavigation.isVisible())) {
    await navigationButton.click();
  }
  await workspaceNavigation.getByRole('button', { name: 'Settings', exact: true }).click();
  await page
    .getByRole('button', { name: /Open (?:optional learning tools|learning workspace)/u })
    .click();
  await expect(page.getByRole('heading', { name: 'Continue learning' })).toBeVisible();
}

async function openLearningPath(page: Page): Promise<void> {
  await openTodayView(page);
  const learningPath = page.getByRole('button', { name: 'Learning path', exact: true });
  await learningPath.click();
}

/** Two headed sections, so a review session has more than one place to draw a prompt from. */
async function addReviewSource(page: Page): Promise<void> {
  await openSources(page);
  await page.getByLabel('Source title').fill('Attention notes');
  await page.getByLabel('Source text').fill(reviewSourceText);
  await page.getByRole('button', { name: 'Save source' }).click();
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
  await expect(page.getByRole('heading', { name: 'AI Fundamentals', exact: true })).toBeVisible();
}

test('a private IndexedDB workspace survives reload when OPFS is unavailable', async ({ page }) => {
  await makeOpfsUnavailable(page);
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('dusori-browser-storage-backend:v1')))
    .toBe('indexeddb');
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  await expect(page.getByText('AI Fundamentals', { exact: true }).first()).toBeVisible();
});

test('the IndexedDB fallback exports and imports a portable workspace', async ({
  browser,
  page,
}) => {
  await makeOpfsUnavailable(page);
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });
  await openInspector(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace' }).click();
  const archive = await (await downloadPromise).path();
  expect(archive).not.toBeNull();

  const context = await browser.newContext();
  const imported = await context.newPage();
  try {
    await makeOpfsUnavailable(imported);
    await imported.goto('/Dusori/app/');
    imported.once('dialog', (dialog) => dialog.accept());
    await imported.locator('#workspace-import input[type="file"]').setInputFiles(archive!);

    await expect(imported.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
    await expect(imported.getByText('AI Fundamentals', { exact: true }).first()).toBeVisible();
    expect(
      await imported.evaluate(() => localStorage.getItem('dusori-browser-storage-backend:v1')),
    ).toBe('indexeddb');
  } finally {
    await context.close();
  }
});

test('a corrupt workspace ZIP stays storage-free and gives focused recovery copy', async ({
  page,
}) => {
  await makeOpfsUnavailable(page);
  await page.goto('/Dusori/app/');

  await page.locator('#workspace-import input[type="file"]').setInputFiles({
    buffer: Buffer.from('not a zip', 'utf8'),
    mimeType: 'application/zip',
    name: 'broken-workspace.zip',
  });

  const alert = page.getByRole('alert');
  await expect(alert).toHaveText(
    'This file is not a valid Dusori workspace export. Choose a .zip exported by Dusori and try again.',
  );
  await expect(alert).toBeFocused();
  expect(
    await page.evaluate(() => localStorage.getItem('dusori-browser-storage-backend:v1')),
  ).toBeNull();
  await expect(page.getByRole('button', { name: 'Create workspace' })).toBeVisible();
});

test('browser Back and Forward restore the chosen map representation', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.getByRole('button', { name: 'Depth map', exact: true }).click();
  await expect(page).toHaveURL(/view=graph.*map=visual/u);

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  await page.goForward();

  await expect(page.getByRole('heading', { name: 'Research map' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Depth map', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('landing, setup, workspace, note, and conflict screens are accessible', async ({ page }) => {
  const cspViolations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) cspViolations.push(message.text());
  });
  await page.goto('/Dusori/');
  await expect(
    page.getByRole('heading', { name: 'Ask a hard question. Follow the evidence.' }),
  ).toBeVisible();
  expect(cspViolations).toEqual([]);
  await expect(page.getByRole('link', { name: /open dusori/iu })).toHaveAttribute(
    'href',
    '/Dusori/app/',
  );
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Docs' }),
  ).toHaveAttribute('href', '/Dusori/docs/');
  const directInstallerHref = `https://github.com/udhawan97/Dusori/releases/download/v${releaseVersion}`;
  await expect(page.getByRole('link', { name: 'Download Apple silicon .dmg' })).toHaveAttribute(
    'href',
    `${directInstallerHref}/Dusori_${releaseVersion}_aarch64-aarch64-apple-darwin.dmg`,
  );
  await expect(page.getByRole('link', { name: 'Download Intel .dmg' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download Windows x64 .exe' })).toHaveAttribute(
    'href',
    `${directInstallerHref}/Dusori_${releaseVersion}_x64-setup-x86_64-pc-windows-msvc.exe`,
  );
  await expect(page.getByRole('link', { name: 'Source ZIP' })).toHaveAttribute(
    'href',
    `https://github.com/udhawan97/Dusori/archive/refs/tags/v${releaseVersion}.zip`,
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
    page.getByRole('heading', { name: 'Make a research desk you can keep.' }),
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

test('first-run certification setup preserves the exact code and stays offline before consent', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      externalRequests.push(request.url());
    }
  });

  await createBrowserWorkspace(page);
  await page.getByRole('button', { name: 'New topic' }).click();
  await page.getByRole('radio', { name: /Certification/u }).check();
  await page.getByLabel('Topic name').fill('AI-103');
  await page.getByRole('button', { name: 'Create topic' }).click();

  await expect(page).toHaveURL(/topic=ai-103/u);
  await expect(
    page.getByRole('heading', { name: 'Add the exact official outline.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import curriculum' }).click();
  await expect(page.getByLabel('Outline text')).toBeVisible();
  await expect(page.getByText(/silently substitute another exam/u)).toBeVisible();
  expect(externalRequests).toEqual([]);

  expect(await readWorkspaceFile(page, 'dusori.json')).toContain('"kind": "certification"');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('heading', { name: 'Add the exact official outline.' })).toBeHidden();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Add the exact official outline.' }),
  ).toBeVisible();
});

test('the four-destination studio keeps research and update truth obvious', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  const studio = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  for (const destination of ['Research', 'Sources', 'Map', 'Settings']) {
    await expect(
      studio.getByRole('button', { name: new RegExp(`^${destination}`, 'u') }),
    ).toBeVisible();
  }
  await expect(studio.getByRole('button', { name: 'Learn', exact: true })).toHaveCount(0);
  await studio.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Optional learning tools' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open optional learning tools' })).toBeVisible();
  await expect(
    page.getByText('The hosted app updates when this website is refreshed.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check now' })).toHaveCount(0);
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

test('landing reflows at a 200% equivalent viewport and honors reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto('/Dusori/');

  const evidence = await page.evaluate(() => {
    const icon = document.querySelector<HTMLElement>('.app-icon-module');
    const figure = document.querySelector<HTMLElement>('.hero-figure');
    return {
      animation: icon ? getComputedStyle(icon).animationName : '',
      clientWidth: document.documentElement.clientWidth,
      figureTransform: figure ? getComputedStyle(figure).transform : '',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(evidence).toMatchObject({
    animation: 'none',
    figureTransform: 'none',
    reducedMotion: true,
  });
  expect(evidence.scrollWidth).toBe(evidence.clientWidth);
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
  await expect(
    page.getByRole('heading', { name: 'From a question to evidence you can inspect.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Separate the trail without losing the links.' }),
  ).toBeVisible();
  await expect(page.getByText('Start with the accessible linear Outline')).toBeVisible();
  await expect(page.getByText('npx @udhawan97/dusori@latest')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Browser, Mac, Windows, or source.' }),
  ).toBeVisible();

  for (const imageName of [
    'Dusori Research Desk with a question, provider outcomes, and saved evidence',
    'Dusori Reading room with a saved local source',
    'Dusori Map with a readable research outline and separated visual evidence atlas',
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

  await expect(page.getByText('Mac and Windows installers are not Apple-notarized')).toBeVisible();

  await page.goto('/Dusori/docs/knowledge-graph/');
  await expect(page.getByRole('heading', { name: 'Map and Outline' })).toBeVisible();
  await expect(page.getByText('Neither view stores a graph database')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('app follows the system and persists an explicit appearance choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/Dusori/app/');

  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to Paper appearance' })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(
    'dark',
  );

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to Night appearance' })).toBeVisible();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to Paper appearance' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch to Paper appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('dusori-appearance'))).toBe('paper');

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'paper');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Switch to Night appearance' })).toBeVisible();

  await page.getByRole('button', { name: 'Switch to Night appearance' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-appearance', 'night');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('dusori-appearance'))).toBe('night');
  await page.getByRole('button', { name: 'Create workspace' }).evaluate(async (button) => {
    await Promise.all(button.getAnimations().map((animation) => animation.finished));
  });
  await expectNoSeriousA11yViolations(page);
});

test('global Settings reloads without a topic and unsafe note URLs fall back safely', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  const navigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  await navigation.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('topic')).toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  await navigation.getByRole('button', { name: 'New topic' }).click();
  await createTopic(page, { remainInResearch: true });
  await page.goto(
    '/Dusori/app/?topic=ai-fundamentals&view=note&path=Topics%2Fai-fundamentals%2F..%2Fdusori.json',
  );
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).not.toBe('note');
});

test('Settings exposes and persists all four appearance modes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await createBrowserWorkspace(page);
  await createTopic(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  for (const appearance of ['paper', 'ink', 'night', 'system'] as const) {
    const label = `${appearance[0]?.toUpperCase()}${appearance.slice(1)}`;
    await page.getByRole('radio', { name: new RegExp(`^${label}`, 'u') }).check();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    expect(await page.evaluate(() => localStorage.getItem('dusori-appearance'))).toBe(appearance);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance);
    await expect(page.getByRole('radio', { name: new RegExp(`^${label}`, 'u') })).toBeChecked();
  }
});

test('Settings previews and archives an invalid source manifest before applying a repair', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });
  const invalidManifest = '{"schemaVersion":1,"sources":[{"title":"Incomplete source"}]}\n';
  await page.evaluate(async (content) => {
    const origin = await navigator.storage.getDirectory();
    const dusori = await origin.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const sources = await topic.getDirectoryHandle('Sources');
    const file = await sources.getFileHandle('manifest.json');
    const writable = await file.createWritable();
    await writable.write(content);
    await writable.close();
  }, invalidManifest);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const recovery = page.getByRole('region', { name: 'Machine-file recovery' });
  await expect(recovery.getByText('1 file needs review')).toBeVisible();
  await expect(recovery.getByRole('textbox', { name: /Original .*manifest\.json/u })).toHaveValue(
    /Incomplete source/u,
  );
  await expect(recovery.getByRole('textbox', { name: /Proposed .*manifest\.json/u })).toHaveValue(
    /"sources": \[\]/u,
  );
  await recovery.getByRole('checkbox', { name: 'I reviewed this exact replacement.' }).check();
  await recovery.getByRole('button', { name: 'Archive original and apply repair' }).click();
  await expect(page.getByText('No invalid recognized machine files were found.')).toBeVisible();

  const stored = await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const dusori = await origin.getDirectoryHandle('Dusori');
    const topic = await (
      await dusori.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const sources = await topic.getDirectoryHandle('Sources');
    const repaired = await (await sources.getFileHandle('manifest.json')).getFile();
    const recoveryRoot = await dusori.getDirectoryHandle('.dusori-recovery');
    const archiveBatch = (await Array.fromAsync(recoveryRoot.values())).find(
      (entry): entry is FileSystemDirectoryHandle => entry.kind === 'directory',
    );
    if (!archiveBatch) return { archived: '', repaired: await repaired.text() };
    const archivedTopic = await (
      await archiveBatch.getDirectoryHandle('Topics')
    ).getDirectoryHandle('ai-fundamentals');
    const archivedSources = await archivedTopic.getDirectoryHandle('Sources');
    const archived = await (await archivedSources.getFileHandle('manifest.json')).getFile();
    return { archived: await archived.text(), repaired: await repaired.text() };
  });
  expect(stored.archived).toBe(invalidManifest);
  expect(JSON.parse(stored.repaired)).toEqual({ schemaVersion: 1, sources: [] });
});

test('startup stops on an invalid workspace index and resumes only after reviewed recovery', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });
  await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const dusori = await origin.getDirectoryHandle('Dusori');
    const file = await dusori.getFileHandle('dusori.json');
    const writable = await file.createWritable();
    await writable.write('{not json');
    await writable.close();
  });
  await page.reload();

  const recovery = page.getByRole('region', { name: 'Your files are still here.' });
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole('textbox', { name: 'Original dusori.json' })).toHaveValue(
    '{not json',
  );
  await expect(recovery.getByRole('textbox', { name: 'Proposed dusori.json' })).toHaveValue(
    /"slug": "ai-fundamentals"/u,
  );
  await recovery.getByRole('checkbox', { name: 'I reviewed this exact replacement.' }).check();
  await recovery.getByRole('button', { name: 'Archive original and apply repair' }).click();

  await expect(page.getByRole('navigation', { name: 'Dusori Research Desk' })).toBeVisible();
  await expect(page.getByText('AI Fundamentals', { exact: true }).first()).toBeVisible();
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

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Research map' })).toBeVisible();
  // The map gets the full workspace while its outline or atlas is open.
  await expect(page.getByRole('complementary', { name: 'Workspace details' })).toBeHidden();
  const atlas = page.getByRole('region', { name: 'Interactive research depth map' });
  await expect(page.getByRole('button', { name: 'Outline', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(atlas).toBeHidden();
  await expect(page.locator('.graph-ledger dt').filter({ hasText: /^Notes$/u })).toBeVisible();
  await expect(
    page.locator('.graph-ledger dt').filter({ hasText: /^Explained edges$/u }),
  ).toBeVisible();
  await expect(page.getByRole('list', { name: 'Map documents' })).toContainText('First look');
  await page.getByRole('button', { name: 'Depth map', exact: true }).click();
  await expect(atlas).toBeVisible();
  await expect(atlas.getByRole('heading', { name: 'AI Fundamentals' })).toBeVisible();
  await expect(atlas.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
  await expect(atlas.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible();
  await expect(atlas.getByRole('heading', { name: 'Briefs & learning' })).toBeVisible();
  await expect(atlas.getByRole('heading', { name: 'Updates', exact: true })).toBeVisible();
  await expect(page.getByText(/\d+ research artifacts · \d+ connections/u)).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await atlas.getByRole('button', { name: /First look/u }).click();
  await expect(page.getByRole('heading', { name: 'First look at AI Fundamentals' })).toBeVisible();
});

test('a wikilink in a rendered document opens what it names', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  const sheet = page.locator('.note-sheet');
  const openOverview = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    await page
      .getByRole('list', { name: 'Map documents' })
      .getByRole('button', { name: 'AI Fundamentals Overview', exact: true })
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

test('visual map separates evidence into readable topic lanes', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addPastedSource(page);

  await openDepthMap(page);
  const atlas = page.getByRole('region', { name: 'Interactive research depth map' });
  const island = atlas.getByRole('button', { name: /AI Fundamentals, .* artifacts/u });
  await expect(island).toBeVisible();
  await island.click();
  await expect(atlas.getByRole('heading', { name: 'AI Fundamentals' })).toBeVisible();
  await expect(atlas.getByRole('button', { name: /Transformer notes/u })).toBeVisible();
  const plane = atlas.locator('.map-plane');
  const initialTransform = await plane.getAttribute('style');
  await atlas.getByRole('button', { name: 'Turn right' }).click();
  await expect(plane).not.toHaveAttribute('style', initialTransform ?? '');
  await expect(page.locator('svg.constellation')).toHaveCount(0);

  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await expectNoSeriousA11yViolations(page);
});

test('depth map keeps every topic reachable as the workspace grows', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await createBrowserWorkspace(page);
  await createTopic(page);

  const topicNames = [
    'AI Fundamentals',
    'Distributed Systems',
    'Climate Adaptation',
    'Cellular Metabolism',
    'Early Modern History',
    'Behavioral Economics',
    'Statistical Inference',
    'Urban Water Systems',
  ];
  for (const topicName of topicNames.slice(1)) {
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topicName);
    await page.getByRole('button', { name: 'Create topic' }).click();
    const providerChoices = page.getByRole('dialog', {
      name: 'Choose where this question may go.',
    });
    await expect(providerChoices).toBeVisible();
    await providerChoices.getByRole('button', { name: 'Decide later' }).click();
    await expect(providerChoices).toBeHidden();
  }

  await openDepthMap(page);
  const atlas = page.getByRole('region', { name: 'Interactive research depth map' });
  const focus = atlas.getByLabel('Focus topic');
  await expect(focus.locator('option')).toHaveCount(topicNames.length);

  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: width === 320 ? 812 : 900 });
    for (const topicName of topicNames) {
      await focus.selectOption({ label: topicName });
      await expect(atlas.getByRole('heading', { name: topicName, exact: true })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }

  const plane = atlas.locator('.map-plane');
  const initialTransform = await plane.getAttribute('style');
  await atlas.getByRole('button', { name: 'Move map up' }).click();
  await expect(plane).not.toHaveAttribute('style', initialTransform ?? '');
  await atlas.getByRole('button', { name: 'Reset depth map' }).click();
  await expectNoSeriousA11yViolations(page);
});

test('insights derives an honest local analytics snapshot', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addPastedSource(page);

  await openTodayView(page);
  await page.getByRole('button', { name: 'Learning evidence' }).click();
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
  const utcLabel = await page.evaluate(() =>
    new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)),
  );
  await expect(page.locator('.pulse-column > span[title]').last()).toHaveAttribute(
    'title',
    new RegExp(`^${utcLabel}: \\d+ recorded changes$`, 'u'),
  );
  await expectNoSeriousA11yViolations(page);
});

test('map outline filters artifacts without changing the separated atlas', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const documents = page.getByRole('list', { name: 'Map documents' });
  await expect.poll(() => documents.getByRole('button').count()).toBeGreaterThan(1);
  const beforeCount = await documents.getByRole('button').count();
  const filters = page.getByRole('group', { name: 'Filter graph artifacts' });
  await filters.getByRole('button', { name: 'Notes', exact: true }).click();
  expect(await documents.getByRole('button').count()).toBeLessThan(beforeCount);
  await expect(documents).toContainText('First look');
  await expect(documents).not.toContainText('AI Fundamentals');

  await page.getByRole('button', { name: 'Depth map', exact: true }).click();
  const atlas = page.getByRole('region', { name: 'Interactive research depth map' });
  await expect(atlas.getByRole('button', { name: /First look/u })).toBeVisible();
  await expect(atlas.getByRole('button', { name: /AI Fundamentals/u }).first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('map outline keeps long artifact titles inside their own row and column', async ({ page }) => {
  await page.setViewportSize({ width: 1059, height: 824 });
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openInspector(page);

  const title = 'Research brief — Explain the central mechanism in your own words. — 2026-08-04';
  await page.getByLabel('New note title').fill(title);
  await page.getByRole('button', { name: 'Create note' }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();

  for (const width of [320, 375, 639, 640, 641, 768, 1059, 1440]) {
    await page.setViewportSize({ width, height: width < 768 ? 812 : 900 });
    const row = page
      .getByRole('list', { name: 'Map documents' })
      .getByRole('button', { name: `${title} Note`, exact: true });
    await expect(row).toBeVisible();

    const geometry = await row.evaluate((button) => {
      const label = button.querySelector('span');
      const kind = button.querySelector('small');
      if (!(label instanceof HTMLElement) || !(kind instanceof HTMLElement)) {
        throw new Error('Artifact row is missing its label or kind.');
      }

      const labelBox = label.getBoundingClientRect();
      const kindBox = kind.getBoundingClientRect();
      const ink = document.createRange();
      ink.selectNodeContents(label);
      const inkRight = Math.max(
        ...Array.from(ink.getClientRects(), (fragment) => fragment.right),
        labelBox.right,
      );

      return {
        inkRight,
        kindLeft: kindBox.left,
        labelClientWidth: label.clientWidth,
        labelScrollWidth: label.scrollWidth,
      };
    });

    expect(
      geometry.inkRight,
      `artifact title paints into its kind label at ${width}px`,
    ).toBeLessThanOrEqual(geometry.kindLeft);
    expect(
      geometry.labelScrollWidth,
      `artifact title escapes its grid column at ${width}px`,
    ).toBeLessThanOrEqual(geometry.labelClientWidth);
  }
});

test('a workspace can grow past its first topic', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);

  await page.getByRole('button', { name: 'New topic' }).click();
  await expect(page.getByRole('heading', { name: 'Open another line of inquiry.' })).toBeVisible();
  await page.getByLabel('Topic name').fill('Distributed Systems Consensus Protocols in Practice');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const providerChoices = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await expect(providerChoices).toBeVisible();
  await providerChoices.getByRole('button', { name: 'Decide later' }).click();
  await expect(providerChoices).toBeHidden();

  const rail = page.getByRole('navigation', { name: 'Dusori Research Desk' });
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

  await openTodayView(page);
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
  await page
    .getByRole('complementary', { name: 'Workspace details' })
    .getByRole('button', { name: 'Close workspace details' })
    .click();
  await page
    .getByRole('navigation', { name: 'Dusori Research Desk' })
    .getByRole('button', { name: 'Map', exact: true })
    .click();
  await page.getByRole('button', { name: 'Open inspector' }).click();
  await expect(page.getByLabel('Outline text')).toHaveValue(/Skills measured/u);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Research map' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('graph');
});

test('the conflict proof brings its proposal on screen', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openTodayView(page);
  await runConflictProof(page);

  // Run from Today, the proof still lands on the note it protected, with the decision in view.
  const accept = page.getByRole('button', { name: 'Accept this proposal' });
  await expect(accept).toBeInViewport();

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
  await expect(page.getByRole('article', { name: 'Reading room' })).toContainText(
    'Attention lets each token weigh the other tokens in its context.',
  );
  await expect(page.locator('.path-label')).toContainText('/Sources/items/');
  await expectNoSeriousA11yViolations(page);
});

test('filters the source shelf, follows the reading trail, and anchors a selected quote', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await addPastedSource(page);

  await openSources(page);
  await page.getByLabel('Source title').fill('Encoding handout');
  await page.getByLabel('Tags optional').fill('Evidence, Encoding');
  await page
    .getByLabel('Source text')
    .fill(
      '# Encoding handout\n\n## Position\n\nPositional encodings preserve sequence order before attention begins.',
    );
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('Encoding handout');
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    '#evidence · #encoding',
  );

  await openSources(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('External reading list');
  await page.getByLabel('Web address').fill('https://example.org/reading-list');
  await page.getByRole('button', { name: 'Save source' }).click();

  const shelf = page.getByRole('list', { name: 'Saved sources' });
  const shelfItems = page.locator('.source-list [role="listitem"]');
  await page.getByLabel('Find a saved source').fill('transformer');
  await expect(shelfItems).toHaveCount(1);
  await expect(shelf).toContainText('Transformer notes');
  const sourceSearch = page.getByLabel('Find a saved source');
  await sourceSearch.fill('');
  await expect(sourceSearch).toHaveValue('');
  await expect(page.getByText('3 sources on this shelf.')).toBeVisible();
  await page.getByRole('button', { name: 'References 1' }).click();
  await expect(shelfItems).toHaveCount(1);
  await expect(shelf).toContainText('External reading list');
  await page.getByRole('button', { name: 'Evidence 2' }).click();
  await expect(shelfItems).toHaveCount(2);
  await page.getByRole('button', { name: 'All 3' }).click();

  await shelf.getByRole('button', { name: 'Transformer notes' }).click();
  const reader = page.getByRole('article', { name: 'Reading room' });
  await expect(reader.locator('#reading-room-title')).toHaveText('Transformer notes');
  await reader.getByRole('button', { name: 'Next source: Encoding handout' }).click();
  await expect(reader.locator('#reading-room-title')).toHaveText('Encoding handout');

  await page.evaluate(() => {
    const paragraph = [...document.querySelectorAll('.reading-room .markdown p')].find((node) =>
      node.textContent?.includes('Positional encodings preserve sequence order'),
    );
    if (!paragraph) throw new Error('Reading passage not found.');
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const quoteAction = reader.getByRole('button', { name: 'Quote selection in a note' });
  await expect(quoteAction).toBeEnabled();
  await quoteAction.click();

  const editor = page.getByLabel('Markdown note');
  await expect(editor).toHaveValue(/> Positional encodings preserve sequence order/u);
  await expect(editor).toHaveValue(/source_heading: "Position"/u);
  await page.getByRole('button', { name: 'Save note' }).click();
  const saved = await waitForWorkspaceFile(
    page,
    'Topics/ai-fundamentals/Notes/notes-on-encoding-handout.md',
  );
  expect(parseSourceAnnotationMetadata(saved)?.locator).toBeDefined();
  await expect(page.locator('.annotation-anchor-status')).toContainText('Quote anchor verified');
  expect(saved).toContain('[[../Sources/items/');
  expect(saved).toContain('|Encoding handout]]');
  expect(saved).toContain('source_content_sha256:');
  expect(saved).toContain('source_locator: {');
  expect(saved).toContain('"normalizationVersion":"dusori-source-text-v1"');
  expect(saved).toContain('tags: [research/annotation]');
  expect(saved).toContain('type: follow-up-to');
  expect(saved).toContain('> Positional encodings preserve sequence order');

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const filters = page.getByRole('group', { name: 'Filter graph artifacts' });
  await filters.getByRole('button', { name: 'Annotations', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Map documents' })).toContainText(
    'Notes on Encoding handout',
  );
  await page.getByRole('button', { name: 'Depth map', exact: true }).click();
  const edges = page.locator('details.edge-inspector');
  await edges.getByText(/Why these \d+ edges exist/u).click();
  await expect(edges).toContainText('Learner-authored follow-up-to relation');
  await expectNoSeriousA11yViolations(page);
});

test('legacy claims on a URL reference never appear as quoted evidence', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openSources(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('Legacy reference');
  await page.getByLabel('Web address').fill('https://example.org/legacy-reference');
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('Legacy reference');

  const manifestPath = 'Topics/ai-fundamentals/Sources/manifest.json';
  const manifest = JSON.parse(await readWorkspaceFile(page, manifestPath)) as {
    sources: Array<Record<string, unknown>>;
  };
  manifest.sources = manifest.sources.map((source) => ({
    ...source,
    claims: [
      {
        at: '2026-08-25T12:00:00.000Z',
        text: 'This legacy value was never read from source text.',
      },
    ],
    readState: 'reference',
  }));
  await writeWorkspaceFile(page, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await page.reload();
  await openSources(page);
  const shelfItem = page
    .locator('.source-list [role="listitem"]')
    .filter({ hasText: 'Legacy reference' });
  await expect(shelfItem).toContainText('URL reference');
  await expect(shelfItem).not.toContainText('quoted');

  await openTodayView(page);
  const mission = page
    .getByRole('list', { name: 'Research missions' })
    .getByRole('listitem')
    .filter({ hasText: 'AI Fundamentals' })
    .first();
  await expect(mission).toContainText('0 read');
  await expect(mission).not.toContainText('quoted');
});

test('filters workspace search by a tag written in the source itself', async ({ page }) => {
  await createBrowserWorkspace(page);
  await createTopic(page);
  await openSources(page);
  await page.getByLabel('Source title').fill('Tagged attention notes');
  await page
    .getByLabel('Source text')
    .fill('Attention weighs tokens against each other. Filed under #attention today.');
  await page.getByRole('button', { name: 'Save source' }).click();
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

/** Replaces one test workspace file through the same OPFS tree the browser adapter uses. */
async function writeWorkspaceFile(page: Page, path: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ target, value }) => {
      const origin = await navigator.storage.getDirectory();
      let directory = await origin.getDirectoryHandle('Dusori');
      const segments = target.split('/');
      const name = segments.pop() as string;
      for (const segment of segments) directory = await directory.getDirectoryHandle(segment);
      const writable = await (await directory.getFileHandle(name)).createWritable();
      await writable.write(value);
      await writable.close();
    },
    { target: path, value: content },
  );
}

async function waitForWorkspaceFile(page: Page, path: string): Promise<string> {
  let content: string | undefined;
  await expect
    .poll(async () => {
      try {
        content = await readWorkspaceFile(page, path);
        return content.length > 0;
      } catch {
        return false;
      }
    })
    .toBe(true);
  return content ?? '';
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
  await openSources(page);

  await page.getByLabel('Source type').selectOption('file');
  await page.getByLabel('Source title').fill('Encoding handout');
  await page.getByRole('button', { name: 'Choose a local file' }).setInputFiles({
    buffer: samplePdf(sentence),
    mimeType: 'application/pdf',
    name: 'encoding-handout.pdf',
  });
  await page.getByRole('button', { name: 'Save source' }).click();

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
  await openSources(page);

  await page.getByLabel('Source type').selectOption('file');
  await page.getByLabel('Source title').fill('Scanned pages');
  await page.getByRole('button', { name: 'Choose a local file' }).setInputFiles({
    buffer: samplePdf(''),
    mimeType: 'application/pdf',
    name: 'scanned-pages.pdf',
  });
  await page.getByRole('button', { name: 'Save source' }).click();

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

  await openInspector(page);
  const refresh = page.getByRole('button', { name: 'Refresh workspace health' });
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect(page.getByRole('list', { name: 'Workspace health issues' })).toContainText(
    'Missing reference',
  );
  await expect(page.getByText('1 issue', { exact: false })).toBeVisible();

  await page
    .getByRole('complementary', { name: 'Workspace details' })
    .getByRole('button', { name: 'Close workspace details' })
    .click();
  const navigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  await navigation.getByRole('button', { name: 'Map', exact: true }).click();
  await page
    .getByRole('list', { name: 'Map documents' })
    .getByRole('button', { name: 'First look Note', exact: true })
    .click();
  await openInspector(page);
  await page.getByRole('button', { name: 'Refresh workspace health' }).click();
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

  await openSources(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('Transformers paper');
  await page.getByLabel('Web address').fill('https://arxiv.org/abs/1706.03762');
  await page.getByRole('button', { name: 'Save source' }).click();
  const transformersSource = page
    .locator('.source-list [role="listitem"]')
    .filter({ hasText: 'Transformers paper' });
  await expect(transformersSource).toContainText('arXiv: 1706.03762');
  await transformersSource.getByRole('button', { name: 'Edit citation' }).click();
  await transformersSource
    .getByRole('textbox', { name: 'Citation identifiers' })
    .fill('DOI: 10.5555/ATTENTION.2026\narXiv: 1706.03762v2');
  await transformersSource
    .getByLabel('Journal or collection optional')
    .fill('Advances in Neural Information Processing Systems');
  await transformersSource.getByRole('button', { name: 'Save citation' }).click();
  await expect(
    page.getByText('Citation details corrected locally. No lookup was made.'),
  ).toBeVisible();
  await expect(transformersSource).toContainText('DOI: 10.5555/attention.2026');
  await expect(transformersSource).toContainText('arXiv: 1706.03762v2');
  await expect(transformersSource).toContainText(
    'Advances in Neural Information Processing Systems',
  );
  await page.getByLabel('Find a saved source').fill('10.5555/attention.2026');
  await expect(page.locator('.source-list [role="listitem"]')).toHaveCount(1);
  await page.getByLabel('Find a saved source').fill('1706.03762');
  await expect(page.locator('.source-list [role="listitem"]')).toHaveCount(1);
  await page.getByLabel('Find a saved source').fill('');
  await expect(transformersSource.getByRole('link', { name: 'Open original' })).toHaveAttribute(
    'href',
    'https://arxiv.org/abs/1706.03762',
  );
  expect(remoteRequests).toEqual([]);

  await page
    .getByRole('listitem')
    .filter({ hasText: 'Transformers paper' })
    .getByRole('button', { name: 'Transformers paper' })
    .click();
  const savedOriginal = page
    .locator('.note-sheet')
    .getByRole('link', { name: 'https://arxiv.org/abs/1706.03762' });
  await expect(savedOriginal).toHaveAttribute('target', '_blank');
  await expect(savedOriginal).toHaveAttribute('rel', /noopener/u);
  await expect(page.locator('#reading-room-title')).toHaveText('Transformers paper');

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
      expect.objectContaining({
        citation: expect.objectContaining({
          identifiers: [
            { scheme: 'doi', value: '10.5555/attention.2026' },
            { scheme: 'arxiv', value: '1706.03762v2' },
          ],
          containerTitle: 'Advances in Neural Information Processing Systems',
          provenance: [
            expect.objectContaining({ method: 'source-url' }),
            expect.objectContaining({ method: 'manual-correction' }),
          ],
        }),
        method: 'url',
        title: 'Transformers paper',
      }),
    ]),
  );
  expect(sourceState.itemNames).toHaveLength(2);
  expect(sourceState.yearNames).not.toEqual([]);

  await openSources(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('Private file');
  await page.getByLabel('Web address').fill('file:///private/notes.txt');
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Dusori stores only http:// or https:// URL references.',
  );
  await expectNoSeriousA11yViolations(page);
});

test('Research Desk groups provider consent and builds a durable source-backed brief', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __dusoriPrintCalls?: number };
    if (window.top === window) {
      state.__dusoriPrintCalls = 0;
      window.addEventListener('message', (event) => {
        if (event.data === 'dusori-test-print') {
          state.__dusoriPrintCalls = (state.__dusoriPrintCalls ?? 0) + 1;
        }
      });
    }
    Object.defineProperty(window, 'print', {
      configurable: true,
      value: () => window.top?.postMessage('dusori-test-print', '*'),
    });
  });
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: 'application/json',
      json:
        url.searchParams.get('list') === 'search'
          ? {
              query: {
                search: [
                  {
                    pageid: 1,
                    size: 5200,
                    snippet: 'An overview of artificial intelligence concepts and capabilities.',
                    title: 'AI fundamentals',
                    wordcount: 620,
                  },
                ],
              },
            }
          : {
              query: {
                pages: {
                  '1': {
                    extract:
                      'Artificial intelligence systems perform tasks associated with human intelligence.\n\n== Machine learning ==\n\nMachine learning uses data to fit models that can make predictions on new examples.\n\n== Responsible AI ==\n\nResponsible AI practices address fairness, reliability, privacy, transparency, and accountability.',
                    pageid: 1,
                    title: 'AI fundamentals',
                  },
                },
              },
            },
    });
  });

  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();

  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('Choices stay separately on this device');
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();

  const thread = page.getByRole('region', { name: 'One place for the whole investigation.' });
  const threadHeading = page.getByRole('heading', {
    name: 'One place for the whole investigation.',
  });
  await expect(threadHeading).toBeVisible();
  await expect(threadHeading).toBeFocused();
  const threadHeadingBox = await threadHeading.boundingBox();
  expect(threadHeadingBox).not.toBeNull();
  expect(threadHeadingBox!.y).toBeGreaterThanOrEqual(0);
  expect(threadHeadingBox!.y + threadHeadingBox!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await expect(
    page.getByRole('list', { name: 'Research thread for AI Fundamentals' }),
  ).toContainText('AI fundamentals');
  await expect(page.getByRole('list', { name: 'Collected research sources' })).toContainText(
    'Read evidence',
  );
  await expect(page.getByRole('button', { name: 'Thread' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const threadIndex = page.getByRole('navigation', { name: 'In this thread' });
  await expect(threadIndex).toBeVisible();
  await expect(thread).toContainText('Evidence boundary.');
  await expect(thread.getByRole('list', { name: 'Typed thread activity' })).toContainText(
    'Question started',
  );
  await expect(thread.getByRole('list', { name: 'Typed thread activity' })).toContainText(
    'Lookup completed',
  );
  await expect(thread.getByRole('list', { name: 'Typed thread activity' })).toContainText(
    'Answer written',
  );
  await thread.getByRole('button', { name: 'Follow updates' }).click();
  const updatesInbox = page.getByRole('region', { name: 'Followed research' });
  await expect(updatesInbox).toContainText('1 followed');
  await expect(updatesInbox).toContainText('no newer local activity yet');
  await page.getByRole('button', { name: 'Update research' }).click();
  await expect(updatesInbox).toContainText('Lookup completed');
  for (const [label, target] of [
    ['Receipt', '#thread-receipt'],
    ['Sources', '#thread-sources'],
    ['Answer & gaps', '#thread-answer'],
    ['Updates', '#thread-history'],
  ] as const) {
    await threadIndex.getByRole('button', { name: label, exact: true }).click();
    const destination = page.locator(target);
    await expect(destination).toBeFocused();
    const box = await destination.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(page.viewportSize()!.height);
  }
  await thread.getByRole('button', { name: 'Open full document' }).click();
  const documentHeading = page
    .getByRole('region', { name: 'Research document' })
    .getByRole('heading', { name: 'Built answer' });
  await expect(documentHeading).toBeFocused();
  await page.getByRole('button', { name: 'Thread', exact: true }).click();

  const markdownDownload = page.waitForEvent('download', (download) =>
    download.suggestedFilename().endsWith('.md'),
  );
  const markdownManifest = page.waitForEvent('download', (download) =>
    download.suggestedFilename().endsWith('.manifest.json'),
  );
  await page.getByText('Export', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print / PDF' })).toBeVisible();
  await page.getByRole('button', { name: 'Markdown' }).click();
  expect((await markdownDownload).suggestedFilename()).toBe('dusori-research-ai-fundamentals.md');
  expect((await markdownManifest).suggestedFilename()).toBe(
    'dusori-research-ai-fundamentals.manifest.json',
  );
  await expect(thread).toContainText('Markdown downloaded.');
  await expect(updatesInbox).toContainText('MARKDOWN export created');

  const htmlDownload = page.waitForEvent('download', (download) =>
    download.suggestedFilename().endsWith('.html'),
  );
  const htmlManifest = page.waitForEvent('download', (download) =>
    download.suggestedFilename().endsWith('.manifest.json'),
  );
  await page.getByRole('button', { name: 'HTML' }).click();
  expect((await htmlDownload).suggestedFilename()).toBe('dusori-research-ai-fundamentals.html');
  expect((await htmlManifest).suggestedFilename()).toBe(
    'dusori-research-ai-fundamentals.manifest.json',
  );
  await expect(thread).toContainText('HTML downloaded.');

  const beforePrint = await Promise.all([
    readWorkspaceFile(page, 'Topics/ai-fundamentals/Synthesis.md'),
    readWorkspaceFile(page, 'Topics/ai-fundamentals/Sources/manifest.json'),
  ]);
  const requestsDuringPrint: string[] = [];
  const collectPrintRequests = (request: { url(): string }) =>
    requestsDuringPrint.push(request.url());
  page.on('request', collectPrintRequests);
  const printManifest = page.waitForEvent('download', (download) =>
    download.suggestedFilename().endsWith('.manifest.json'),
  );
  await page.getByRole('button', { name: 'Print / PDF' }).click();
  expect((await printManifest).suggestedFilename()).toBe(
    'dusori-research-ai-fundamentals.manifest.json',
  );
  const printFrame = page.frameLocator('iframe[title="Print AI Fundamentals research thread"]');
  await expect(printFrame.locator('body')).toContainText('Research thread — AI Fundamentals');
  await expect(printFrame.locator('body')).toContainText('Read evidence');
  await expect(printFrame.locator('body')).toContainText('A saved reference is not evidence');
  await expect(printFrame.locator('a[href="https://en.wikipedia.org/?curid=1"]')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __dusoriPrintCalls?: number }).__dusoriPrintCalls ?? 0,
      ),
    )
    .toBe(1);
  await expect(thread).toContainText('readable derivative');
  page.off('request', collectPrintRequests);
  expect(requestsDuringPrint).toEqual([]);
  expect(
    await Promise.all([
      readWorkspaceFile(page, 'Topics/ai-fundamentals/Synthesis.md'),
      readWorkspaceFile(page, 'Topics/ai-fundamentals/Sources/manifest.json'),
    ]),
  ).toEqual(beforePrint);
  const researchAfterPrint = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as { events?: Array<{ format?: string; type: string }> };
  expect(researchAfterPrint.events?.at(-1)).toMatchObject({
    format: 'pdf',
    type: 'export-created',
  });

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const mapFilters = page.getByRole('group', { name: 'Filter graph artifacts' });
  await mapFilters.getByRole('button', { name: 'Events', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Map documents' })).toContainText('Answer written');
  await page.getByRole('button', { name: 'Depth map', exact: true }).click();
  const edgeInspector = page.locator('details.edge-inspector');
  await edgeInspector.getByText(/Why these \d+ edges exist/u).click();
  await edgeInspector.getByRole('button', { name: 'Answer written', exact: true }).first().click();
  await expect(page.locator('.focused-event')).toContainText('Selected from Depth map');
  await expect(page.locator('.focused-event')).toContainText('Answer written');

  await page.getByRole('checkbox', { name: /Recheck after seven days/u }).check();
  await expect
    .poll(
      async () =>
        JSON.parse(await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'))
          .autoRefresh,
    )
    .toBe(true);

  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Research document' })).toContainText(
    'Synthesis — AI Fundamentals',
  );
  await openSources(page);
  const savedSources = page.getByRole('list', { name: 'Saved sources' });
  await expect(savedSources).toContainText('AI fundamentals');
  await page.setViewportSize({ width: 320, height: 760 });
  expect(
    await savedSources.evaluate((element) => {
      const viewportWidth = window.innerWidth;
      return [...element.querySelectorAll<HTMLElement>('*')].every((child) => {
        const box = child.getBoundingClientRect();
        return box.right <= viewportWidth + 1 && box.left >= -1;
      });
    }),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  const artifacts = await Promise.all([
    readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
    readWorkspaceFile(page, 'Topics/ai-fundamentals/Synthesis.md'),
    readWorkspaceFile(page, 'Topics/ai-fundamentals/Sources/manifest.json'),
  ]);
  expect(artifacts[0]).toContain('Wikipedia');
  expect(artifacts[1]).toContain('AI fundamentals');
  expect(artifacts[2]).toContain('api-extract');

  await page.reload();
  await openResearch(page);
  await expect(page.getByRole('list', { name: 'Provider receipt' })).toContainText('Wikipedia');
  await expect(page.getByRole('list', { name: 'Provider receipt' })).toContainText('1 found');
  await expect(
    page.getByRole('list', { name: 'Research thread for AI Fundamentals' }),
  ).toContainText('AI Fundamentals');

  for (const viewport of [
    { width: 320, height: 760 },
    { width: 375, height: 812 },
    { width: 414, height: 896 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(thread).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    expect(await thread.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    if (viewport.width === 375) {
      expect(
        await thread.evaluate((element) => element.getBoundingClientRect().height),
      ).toBeLessThan(5_000);
    }
  }
  await expectNoSeriousA11yViolations(page);

  await thread.getByText('Privacy', { exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await thread.getByRole('button', { name: 'Redact question' }).click();
  await expect(thread).toContainText('Question redacted from the local ledger');
  const redactedResearch = await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json');
  expect(redactedResearch).not.toContain('"questionText": "AI Fundamentals"');
  expect(redactedResearch).toContain('"type": "thread-redacted"');
  expect(await readWorkspaceFile(page, 'Topics/ai-fundamentals/Synthesis.md')).toContain(
    'AI fundamentals',
  );

  page.once('dialog', (dialog) => dialog.accept());
  await thread.getByRole('button', { name: 'Delete thread ledger' }).click();
  await expect(thread).toContainText('Thread ledger deleted');
  const deletedResearch = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as {
    events?: unknown[];
    runs?: unknown[];
    threadTombstones?: Array<{ reason: string }>;
    threads?: unknown[];
  };
  expect(deletedResearch.threads).toEqual([]);
  expect(deletedResearch.runs).toEqual([]);
  expect(deletedResearch.events).toEqual([]);
  expect(deletedResearch.threadTombstones).toEqual([]);
});

test('provider recovery preserves the question and returns without making a request', async ({
  page,
}) => {
  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('Spaced repetition');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await disclosure.getByRole('button', { name: 'Decide later' }).click();

  const exactQuestion = 'How does spaced repetition improve durable learning?';
  await page.getByLabel('Your question').fill(exactQuestion);
  await page.getByRole('button', { name: 'Research and build' }).click();
  await disclosure.getByRole('button', { name: 'Keep all off' }).click();
  await expect(page.getByRole('alert')).toContainText('Every relevant provider was kept off');

  await page.getByRole('button', { name: 'Review provider choices' }).click();
  const providerChoicesHeading = page.locator('#provider-choices-title');
  await expect(providerChoicesHeading).toBeFocused();
  await expect(page.getByRole('list', { name: 'Saved provider decisions' })).toContainText(
    'Denied',
  );

  const resetChoices = page.getByRole('button', { name: 'Reset choice' });
  while ((await resetChoices.count()) > 0) await resetChoices.first().click();
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    if (/w\/api\.php|api\.github\.com|api\.openalex\.org|api\.crossref\.org/u.test(request.url())) {
      providerRequests.push(request.url());
    }
  });
  await page.getByRole('button', { name: 'Return to research' }).click();
  await expect(page.getByLabel('Your question')).toHaveValue(exactQuestion);
  await expect(disclosure).toBeHidden();
  await page.waitForTimeout(250);
  expect(providerRequests).toEqual([]);

  await page.getByRole('button', { name: 'Research and build' }).click();
  await disclosure.getByRole('button', { name: 'Keep all off' }).click();
  await page.getByRole('button', { name: 'Review provider choices' }).click();
  await openSources(page);
  const workspaceNavigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  await workspaceNavigation.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return to research' })).toHaveCount(0);
});

test('provider recovery keeps an existing draft and suppresses its stale auto-refresh', async ({
  page,
}) => {
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: 'application/json',
      json:
        url.searchParams.get('list') === 'search'
          ? {
              query: {
                search: [
                  {
                    pageid: 1,
                    size: 5200,
                    snippet:
                      'Spaced repetition supports durable learning through scheduled retrieval.',
                    title: 'Spaced repetition',
                    wordcount: 620,
                  },
                ],
              },
            }
          : {
              query: {
                pages: {
                  '1': {
                    extract:
                      'Spaced repetition is a learning technique that schedules reviews over increasing intervals to support durable learning.\n\n== Retrieval practice ==\n\nRetrieval practice uses active recall to strengthen later access more than simply rereading the same material.\n\n== Review timing ==\n\nWell-timed review improves durable learning by adjusting the next interval after each recall attempt.',
                    pageid: 1,
                    title: 'Spaced repetition',
                  },
                },
              },
            },
    });
  });

  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('Spaced repetition');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toBeVisible();

  const recoveryQuestion = 'Which retrieval schedule best preserves durable learning?';
  await page.getByLabel('Your question').fill(recoveryQuestion);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('dusori-research-consent:v2:')) localStorage.removeItem(key);
    }
  });
  await page.getByRole('button', { name: 'Research and build' }).click();
  await disclosure.getByRole('button', { name: 'Keep all off' }).click();
  await page.getByRole('button', { name: 'Review provider choices' }).click();

  const research = JSON.parse(
    await readWorkspaceFile(page, 'Topics/spaced-repetition/research.json'),
  ) as { autoRefresh?: boolean; lastRunAt?: string };
  research.autoRefresh = true;
  research.lastRunAt = '2020-01-01T00:00:00.000Z';
  await writeWorkspaceFile(
    page,
    'Topics/spaced-repetition/research.json',
    `${JSON.stringify(research, null, 2)}\n`,
  );
  const resetChoices = page.getByRole('button', { name: 'Reset choice' });
  while ((await resetChoices.count()) > 0) await resetChoices.first().click();
  await page.evaluate(() => {
    localStorage.setItem('dusori-research-consent:v2:wikipedia', 'allowed');
  });

  const providerRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('en.wikipedia.org/w/api.php')) providerRequests.push(request.url());
  });
  await page.getByRole('button', { name: 'Return to research' }).click();
  await expect(page.getByLabel('Your question')).toHaveValue(recoveryQuestion);
  await page.waitForTimeout(300);
  expect(providerRequests).toEqual([]);
  await expect(page.getByRole('button', { name: 'Review provider choices' })).toHaveCount(0);

  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('dusori-research-consent:v2:')) localStorage.removeItem(key);
    }
  });
  await page.getByRole('button', { name: 'Research and build' }).click();
  await disclosure.getByRole('button', { name: 'Keep all off' }).click();
  await page.getByRole('button', { name: 'Review provider choices' }).click();
  const secondResetChoices = page.getByRole('button', { name: 'Reset choice' });
  while ((await secondResetChoices.count()) > 0) await secondResetChoices.first().click();
  await page.evaluate(() => {
    localStorage.setItem('dusori-research-consent:v2:wikipedia', 'allowed');
  });
  await openSources(page);
  await openResearch(page);
  await expect(page.getByLabel('Your question')).toHaveValue(recoveryQuestion);
  await page.waitForTimeout(300);
  expect(providerRequests).toEqual([]);
});

test('mobile source rows wrap and transient topic status does not follow navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await createBrowserWorkspace(page);
  await createTopic(page, { remainInResearch: true });
  await expect(page.locator('.mobile-status')).toContainText('Topic created.');
  await openSources(page);
  await expect(page.locator('.mobile-status')).toBeHidden();

  const longTitle = `A deliberately long source title about spaced repetition ${'and durable learning '.repeat(8)}`;
  await page.getByLabel('Source title').fill(longTitle.slice(0, 240));
  await page
    .getByLabel('Source text')
    .fill('Spaced retrieval at increasing intervals can support durable recall.');
  await page.getByRole('button', { name: 'Save source' }).click();
  const savedSources = page.getByRole('list', { name: 'Saved sources' });
  await expect(savedSources).toContainText('A deliberately long source title');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  expect(
    await savedSources.evaluate((element) => {
      const viewportWidth = window.innerWidth;
      return [...element.querySelectorAll<HTMLElement>('*')].every((child) => {
        const box = child.getBoundingClientRect();
        return box.right <= viewportWidth + 1 && box.left >= -1;
      });
    }),
  ).toBe(true);
});

test('Research Desk restores an exact custom question for manual and stale refreshes', async ({
  page,
}) => {
  const searched: string[] = [];
  let delayNextSearch = false;
  let staleSearchStarted = false;
  let releaseStaleSearch = (): void => undefined;
  const staleSearchGate = new Promise<void>((resolve) => {
    releaseStaleSearch = resolve;
  });
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('list') === 'search') {
      if (delayNextSearch) {
        staleSearchStarted = true;
        await staleSearchGate;
        delayNextSearch = false;
      }
      const query = url.searchParams.get('srsearch') ?? '';
      searched.push(query);
      const isCustom = query.includes('How do AI systems support human decisions?');
      await route.fulfill({
        contentType: 'application/json',
        json: {
          query: {
            search: [
              {
                pageid: isCustom ? 2 : 1,
                size: 5200,
                snippet: isCustom
                  ? 'AI systems support human decisions with machine learning predictions and review.'
                  : 'Artificial intelligence fundamentals introduce machine learning and responsible AI.',
                title: isCustom ? 'Human-centered AI decisions' : 'AI fundamentals',
                wordcount: 620,
              },
            ],
          },
        },
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        query: {
          pages: {
            '1': {
              extract:
                'Artificial intelligence systems perform tasks associated with human intelligence. Machine learning uses data to fit models.',
              pageid: 1,
              title: 'AI fundamentals',
            },
            '2': {
              extract:
                'AI systems can support human decisions with predictions. Human review remains important for accountability and context.',
              pageid: 2,
              title: 'Human-centered AI decisions',
            },
          },
        },
      },
    });
  });

  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();

  const exactQuestion = 'How do AI systems support human decisions?';
  await page.getByLabel('Your question').fill(exactQuestion);
  await page.getByRole('button', { name: 'Research and build' }).click();
  const thread = page.getByRole('list', { name: 'Research thread for AI Fundamentals' });
  await expect(thread.getByText(exactQuestion, { exact: true })).toBeVisible();
  let research = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as {
    autoRefresh?: boolean;
    lastRunAt: string;
    runs: Array<{ at: string; questionText?: string; searchText: string }>;
  };
  expect(research.runs.at(-1)).toMatchObject({
    questionText: exactQuestion,
    searchText: `AI Fundamentals ${exactQuestion}`,
  });

  await page.reload();
  await openResearch(page);
  await expect(page.getByLabel('Your question')).toHaveValue(exactQuestion);
  const beforeManual = research.runs.length;
  await page.getByRole('button', { name: 'Update research' }).click();
  await expect
    .poll(async () => {
      const value = JSON.parse(
        await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
      ) as { runs: unknown[] };
      return value.runs.length;
    })
    .toBe(beforeManual + 1);
  expect(searched.at(-1)).toContain(exactQuestion);

  await page.getByRole('checkbox', { name: /Recheck after seven days/u }).check();
  await expect
    .poll(
      async () =>
        (
          JSON.parse(await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json')) as {
            autoRefresh?: boolean;
          }
        ).autoRefresh,
    )
    .toBe(true);
  research = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as typeof research;
  const oldAt = '2020-01-01T00:00:00.000Z';
  research.lastRunAt = oldAt;
  research.runs[research.runs.length - 1]!.at = oldAt;
  await writeWorkspaceFile(
    page,
    'Topics/ai-fundamentals/research.json',
    `${JSON.stringify(research, null, 2)}\n`,
  );
  const beforeAutomatic = research.runs.length;
  delayNextSearch = true;
  await page.reload();
  await openResearch(page);
  await expect.poll(() => staleSearchStarted).toBe(true);
  const retainedFocus = page.getByRole('button', { name: 'Depth map', exact: true });
  await retainedFocus.focus();
  await page.evaluate(() => {
    window.scrollTo({
      left: 0,
      top: Math.min(320, document.documentElement.scrollHeight - innerHeight),
    });
  });
  const retainedScroll = await page.evaluate(() => window.scrollY);
  expect(retainedScroll).toBeGreaterThan(0);
  releaseStaleSearch();
  await expect
    .poll(async () => {
      const value = JSON.parse(
        await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
      ) as { runs: unknown[] };
      return value.runs.length;
    })
    .toBe(beforeAutomatic + 1);
  await expect(retainedFocus).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(retainedScroll);
  await expect(disclosure).toBeHidden();
  await expect(page.getByLabel('Your question')).toHaveValue(exactQuestion);
  expect(searched.at(-1)).toContain(exactQuestion);
});

test.describe('research initialization races', () => {
  test.use({ serviceWorkers: 'block' });

  test('a question typed during initialization suppresses the older stale refresh', async ({
    page,
  }) => {
    let delayCapabilities = false;
    let capabilitiesStarted = false;
    let capabilitiesFinished = false;
    let releaseCapabilities = (): void => undefined;
    const capabilitiesGate = new Promise<void>((resolve) => {
      releaseCapabilities = resolve;
    });
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ headers: { 'cache-control': 'no-store' }, json: companionHealth });
    });
    await page.route('**/api/research/capabilities', async (route) => {
      if (delayCapabilities) {
        capabilitiesStarted = true;
        await capabilitiesGate;
        delayCapabilities = false;
      }
      await route.fulfill({ json: companionResearchCapabilities });
      capabilitiesFinished = true;
    });
    await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        contentType: 'application/json',
        json:
          url.searchParams.get('list') === 'search'
            ? {
                query: {
                  search: [
                    {
                      pageid: 1,
                      size: 5200,
                      snippet:
                        'Spaced repetition schedules retrieval practice to support durable learning.',
                      title: 'Spaced repetition',
                      wordcount: 620,
                    },
                  ],
                },
              }
            : {
                query: {
                  pages: {
                    '1': {
                      extract:
                        'Spaced repetition schedules reviews over increasing intervals to support durable learning. Retrieval practice uses active recall to strengthen later access. Review timing changes the next interval after each recall attempt.',
                      pageid: 1,
                      title: 'Spaced repetition',
                    },
                  },
                },
              },
      });
    });

    await createBrowserWorkspace(page);
    await expectCompanionConnected(page);
    await page.getByLabel('Topic name').fill('Spaced repetition');
    await page.getByRole('button', { name: 'Create topic' }).click();
    const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
    await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
    await disclosure.getByRole('button', { name: 'Save choices and research' }).click();
    await expect(
      page.getByRole('heading', { name: 'One place for the whole investigation.' }),
    ).toBeVisible();

    const research = JSON.parse(
      await readWorkspaceFile(page, 'Topics/spaced-repetition/research.json'),
    ) as { autoRefresh?: boolean; lastRunAt?: string; runs: Array<{ at: string }> };
    research.autoRefresh = true;
    research.lastRunAt = '2020-01-01T00:00:00.000Z';
    research.runs[research.runs.length - 1]!.at = '2020-01-01T00:00:00.000Z';
    await writeWorkspaceFile(
      page,
      'Topics/spaced-repetition/research.json',
      `${JSON.stringify(research, null, 2)}\n`,
    );
    const runsBeforeReentry = research.runs.length;
    await openSources(page);

    const providerRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('en.wikipedia.org/w/api.php'))
        providerRequests.push(request.url());
    });
    capabilitiesFinished = false;
    delayCapabilities = true;
    await openResearch(page);
    await expect.poll(() => capabilitiesStarted).toBe(true);
    const inFlightQuestion = 'Which practice schedule should I compare next?';
    await page.getByLabel('Your question').fill(inFlightQuestion);
    releaseCapabilities();
    await expect.poll(() => capabilitiesFinished).toBe(true);
    await page.waitForTimeout(400);

    await expect(page.getByLabel('Your question')).toHaveValue(inFlightQuestion);
    expect(providerRequests).toEqual([]);
    expect(
      (
        JSON.parse(await readWorkspaceFile(page, 'Topics/spaced-repetition/research.json')) as {
          runs: unknown[];
        }
      ).runs,
    ).toHaveLength(runsBeforeReentry);
  });
});

test('an edited synthesis keeps its original question through update, reload, and export', async ({
  page,
}) => {
  let searchRun = 0;
  let returnEmpty = false;
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('list') === 'search') {
      if (returnEmpty) {
        await route.fulfill({ contentType: 'application/json', json: { query: { search: [] } } });
        return;
      }
      searchRun += 1;
      const updated = searchRun > 1;
      await route.fulfill({
        contentType: 'application/json',
        json: {
          query: {
            search: [
              {
                pageid: searchRun,
                size: 5200,
                snippet: updated
                  ? 'Artificial intelligence teams use machine learning with human review and accountability.'
                  : 'Artificial intelligence fundamentals include machine learning concepts.',
                title: updated ? 'Human review in AI systems' : 'AI fundamentals',
                wordcount: 620,
              },
            ],
          },
        },
      });
      return;
    }
    const pageId = url.searchParams.get('pageids') ?? '1';
    const updated = pageId !== '1';
    await route.fulfill({
      contentType: 'application/json',
      json: {
        query: {
          pages: {
            [pageId]: {
              extract: updated
                ? 'Artificial intelligence teams use machine learning systems with human review. Accountability requires people to inspect important decisions and their context.'
                : 'Artificial intelligence systems perform tasks associated with human intelligence. Machine learning uses data to fit models and make predictions.',
              pageid: Number(pageId),
              title: updated ? 'Human review in AI systems' : 'AI fundamentals',
            },
          },
        },
      },
    });
  });

  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toBeVisible();

  const synthesisPath = 'Topics/ai-fundamentals/Synthesis.md';
  const editedSynthesis =
    '# My edited AI synthesis\n\nThis learner-authored wording must remain the built answer.\n';
  await writeWorkspaceFile(page, synthesisPath, editedSynthesis);
  const laterQuestion = 'How does artificial intelligence use machine learning with human review?';
  await page.getByLabel('Your question').fill(laterQuestion);
  await page.getByRole('button', { name: 'Update research' }).click();
  await expect(page.getByText(/did not replace this completed answer/u)).toBeVisible();

  const research = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as {
    synthesisRunAt?: string;
    runs: Array<{ at: string; questionText?: string; synthesisOutcome?: string }>;
  };
  expect(research.synthesisRunAt).toBe(research.runs[0]?.at);
  expect(research.runs.map((run) => run.synthesisOutcome)).toEqual(['written', 'proposed']);
  expect(await readWorkspaceFile(page, synthesisPath)).toBe(editedSynthesis);

  await openTodayView(page);
  const attention = page.getByRole('list', { name: 'Needs attention' });
  await attention.getByRole('button', { name: /review proposal for Synthesis/iu }).click();
  await page.getByRole('button', { name: 'Keep current document' }).click();
  await openResearch(page);
  await expect(page.getByText(/proposal is waiting in Needs attention/u)).toHaveCount(0);
  const keptResearch = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as typeof research;
  expect(keptResearch.runs.map((run) => run.synthesisOutcome)).toEqual(['written', 'kept']);

  returnEmpty = true;
  const emptyQuestion = 'What changed in the latest AI review?';
  await page.getByLabel('Your question').fill(emptyQuestion);
  await page.getByRole('button', { name: 'Update research' }).click();
  await expect(page.getByText(/found no relevant sources/u)).toBeVisible();
  await expect(page.getByText(/did not replace this completed answer/u)).toBeVisible();

  await page.reload();
  await openResearch(page);
  const thread = page.getByRole('list', { name: 'Research thread for AI Fundamentals' });
  await expect(thread.locator('.question')).toHaveText('AI Fundamentals');
  await expect(page.getByText(/proposal is waiting in Needs attention/u)).toHaveCount(0);

  const markdownDownload = page.waitForEvent('download');
  await page.getByText('Export', { exact: true }).click();
  await page.getByRole('button', { name: 'Markdown' }).click();
  const download = await markdownDownload;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const markdown = readFileSync(downloadPath!, 'utf8');
  expect(markdown).toMatch(/## Question\s+AI Fundamentals/u);
  expect(markdown).toContain(laterQuestion);
  expect(markdown).toContain(emptyQuestion);
  expect(markdown).toContain('did not replace the completed answer');
  expect(markdown).not.toContain('proposal was saved separately');
  expect(markdown).toContain('This learner-authored wording must remain the built answer.');

  returnEmpty = false;
  const acceptedQuestion =
    'How should artificial intelligence teams review machine learning decisions?';
  await page.getByLabel('Your question').fill(acceptedQuestion);
  await page.getByRole('button', { name: 'Update research' }).click();
  await expect(page.locator('.notice')).toContainText('proposal is waiting in Needs attention');
  await openTodayView(page);
  await page
    .getByRole('list', { name: 'Needs attention' })
    .getByRole('button', { name: /review proposal for Synthesis/iu })
    .click();
  await page.getByRole('button', { name: 'Accept this proposal' }).click();
  await expect(
    page.getByText('You accepted the proposal. Dusori updated the note and logged that decision.'),
  ).toBeVisible();

  await page.reload();
  await openResearch(page);
  const acceptedResearch = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as typeof research;
  expect(acceptedResearch.runs.map((run) => run.synthesisOutcome)).toEqual([
    'written',
    'kept',
    undefined,
    'written',
  ]);
  expect(acceptedResearch.synthesisRunAt).toBe(acceptedResearch.runs.at(-1)?.at);
  expect(acceptedResearch.runs.at(-1)?.synthesisOutcome).toBe('written');
  const acceptedThread = page.getByRole('list', {
    name: 'Research thread for AI Fundamentals',
  });
  await expect(acceptedThread.locator('.question')).toHaveText(acceptedQuestion);
  await expect(page.getByText(/proposal is waiting in Needs attention/u)).toHaveCount(0);

  const acceptedDownloadPromise = page.waitForEvent('download');
  await page.getByText('Export', { exact: true }).click();
  await page.getByRole('button', { name: 'Markdown' }).click();
  const acceptedDownloadPath = await (await acceptedDownloadPromise).path();
  expect(acceptedDownloadPath).not.toBeNull();
  const acceptedMarkdown = readFileSync(acceptedDownloadPath!, 'utf8');
  expect(acceptedMarkdown).toMatch(
    /## Question\s+How should artificial intelligence teams review machine learning decisions\?/u,
  );
  expect(acceptedMarkdown).not.toContain(
    'This learner-authored wording must remain the built answer.',
  );
});

test('Research Desk lets the learner approve ranked results beyond the first shelf', async ({
  page,
}) => {
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('list') !== 'search') {
      const pageId = url.searchParams.get('pageids') ?? '0';
      await route.fulfill({
        contentType: 'application/json',
        json: {
          query: {
            pages: {
              [pageId]: {
                extract:
                  'Attention mechanisms compare a query with keys and use the resulting weights to combine values. This lets a model connect relevant context while preserving an inspectable source trail. Multiple attention heads can emphasize different relationships in parallel.',
                pageid: Number(pageId),
                title: `Attention research source ${pageId}`,
              },
            },
          },
        },
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        query: {
          search: Array.from({ length: 8 }, (_, index) => ({
            pageid: index + 1,
            size: 4_000 + index,
            snippet: `Attention research source ${index + 1} explains attention mechanisms.`,
            title: `Attention research source ${index + 1}`,
            wordcount: 500 + index,
          })),
        },
      },
    });
  });
  await page.route('https://api.openalex.org/works**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== '/works') {
      await route.fulfill({ status: 503, json: { error: 'capture unavailable in fixture' } });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        results: [
          {
            abstract_inverted_index: null,
            authorships: [],
            cited_by_count: 12,
            display_name: 'Attention research evidence review',
            doi: null,
            id: 'https://openalex.org/W9000',
            primary_location: null,
            publication_date: '2025-01-15',
            publication_year: 2025,
            type: 'article',
          },
        ],
      },
    });
  });

  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('Attention Research');
  await page.getByRole('button', { name: 'Create topic' }).click();

  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await disclosure.getByRole('checkbox', { name: /^OpenAlex/u }).check();
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();

  await expect(page.getByText('Show 1 more results')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  expect(
    JSON.parse(await readWorkspaceFile(page, 'Topics/attention-research/Sources/manifest.json'))
      .sources,
  ).toHaveLength(8);

  await page.getByText('Show 1 more results').click();
  await expect(page.locator('.overflow-intro')).toContainText('saved only when you approve');
  const furtherResults = page.getByRole('list', { name: 'Further research results' });
  const approve = furtherResults.getByRole('button', { name: /^Approve and add .+ to Sources$/u });
  await approve.click();

  await expect(approve).toBeDisabled();
  await expect(furtherResults).toContainText('Added to Sources');
  expect(
    JSON.parse(await readWorkspaceFile(page, 'Topics/attention-research/Sources/manifest.json'))
      .sources,
  ).toHaveLength(9);
  await openSources(page);
  await expect(page.locator('.source-list [role="listitem"]')).toHaveCount(9);
  await expectNoSeriousA11yViolations(page);
  await openResearch(page);
  await page.getByRole('button', { name: 'Document', exact: true }).click();
  await page.getByRole('button', { name: 'Open as note' }).click();
  await expect(page.getByRole('heading', { name: 'Synthesis — Attention Research' })).toBeVisible();
});

test('Research Desk keeps empty and failed provider outcomes distinct after reload', async ({
  page,
}) => {
  const wikipedia = 'https://en.wikipedia.org/w/api.php**';
  await page.route(wikipedia, async (route) => {
    await route.fulfill({ contentType: 'application/json', json: { query: { search: [] } } });
  });
  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();

  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();
  await expect(page.getByRole('region', { name: 'Latest lookup' })).toContainText(
    'Wikipedia empty.',
  );
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toHaveCount(0);
  await expect(page.getByText(/(?:no relevant sources|found no sources)/iu)).toBeVisible();

  await page.reload();
  await openResearch(page);
  await expect(page.getByRole('region', { name: 'Latest lookup' })).toContainText(
    'Wikipedia empty.',
  );

  await page.unroute(wikipedia);
  await page.route(wikipedia, async (route) => route.abort('internetdisconnected'));
  await page.getByLabel('Your question').fill('Why do AI systems fail?');
  await page.getByRole('button', { name: 'Research and build' }).click();
  await expect(page.getByRole('region', { name: 'Latest lookup' })).toContainText(
    'Wikipedia failed.',
  );
  await expect(page.getByText(/failed at every provider/iu)).toBeVisible();

  await page.reload();
  await openResearch(page);
  const latest = page.getByRole('region', { name: 'Latest lookup' });
  await expect(latest).toContainText('Why do AI systems fail?');
  await expect(latest).toContainText('Wikipedia failed.');
  await expect(page.getByText(/latest lookup failed at every provider/iu)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toHaveCount(0);
});

test('an off-topic-only update preserves but does not replace the completed answer', async ({
  page,
}) => {
  let returnOffTopic = false;
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('list') === 'search') {
      await route.fulfill({
        contentType: 'application/json',
        json: {
          query: {
            search: [
              returnOffTopic
                ? {
                    pageid: 2,
                    size: 4000,
                    snippet: 'How irrigation works in dry climates.',
                    title: 'Irrigation mechanisms',
                    wordcount: 500,
                  }
                : {
                    pageid: 1,
                    size: 5200,
                    snippet: 'An overview of artificial intelligence fundamentals.',
                    title: 'AI fundamentals',
                    wordcount: 620,
                  },
            ],
          },
        },
      });
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      json: {
        query: {
          pages: {
            '1': {
              extract:
                'Artificial intelligence systems perform tasks associated with human intelligence.\n\n== Machine learning ==\n\nMachine learning uses data to fit models.',
              pageid: 1,
              title: 'AI fundamentals',
            },
          },
        },
      },
    });
  });

  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();
  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toBeVisible();

  await openResearch(page);
  returnOffTopic = true;
  await page.getByLabel('Your question').fill('How does irrigation work?');
  await page.getByRole('button', { name: 'Research and build' }).click();
  await expect(page.getByText(/no relevant sources/iu)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toBeVisible();
  await expect(page.getByText(/did not replace this completed answer/u)).toBeVisible();
  const research = JSON.parse(
    await readWorkspaceFile(page, 'Topics/ai-fundamentals/research.json'),
  ) as { runs: Array<{ eligibleCount?: number }> };
  expect(research.runs.at(-1)?.eligibleCount).toBe(0);

  await page.reload();
  await openResearch(page);
  await expect(page.getByText(/found no relevant sources/u)).toBeVisible();
  await page.getByText('View research history', { exact: true }).click();
  const latestTrailRun = page
    .getByRole('list', { name: 'Research trail runs' })
    .getByRole('listitem')
    .filter({ hasText: 'How does irrigation work?' })
    .first();
  await expect(latestTrailRun).toContainText('Wikipedia');
  await expect(latestTrailRun).toContainText('found 1');
  await expect(
    page.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Research thread for AI Fundamentals' }),
  ).toContainText('AI Fundamentals');
});

// The unit test reads the policy out of `app.html`; this one proves the browser agrees on the
// artifact that actually ships. Each origin is stubbed with a permissive CORS reply, so an
// allowed probe is answered locally and nothing leaves the machine. The content-security-policy
// is enforced ahead of the network stack, so a forbidden origin never reaches its route and is
// the only way a probe can fail.
test('the shipped policy lets every browser-called provider origin through', async ({ page }) => {
  const origins = researchProviderPolicy.browserOrigins;
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
  await openSources(page);
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
  await expect(page.getByRole('heading', { name: 'AI Fundamentals', exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'AI Fundamentals', exact: true })).toBeVisible();
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

  await openInspector(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export workspace' }).click();
  const download = await downloadPromise;
  const archive = await download.path();
  expect(archive).not.toBeNull();

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain(
      'Replace this browser workspace with “My research workspace”?',
    );
    expect(dialog.message()).toContain('1 topic');
    expect(dialog.message()).toMatch(/\d+ files/u);
    expect(dialog.message()).toContain('validated before this confirmation');
    dialog.accept();
  });
  await page.locator('aside input[type="file"]').setInputFiles(archive!);
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  await openSources(page);
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Transformer notes',
  );
  await openLearningPath(page);
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

  await openLearningPath(page);
  const firstObjective = page.getByLabel('Establish the terms and boundaries.');
  await firstObjective.check();
  await expect(firstObjective).toBeChecked();
  await expect(page.getByText('33%', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Paused' }).click();
  await expect(page.getByRole('button', { name: 'Paused' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await openTodayView(page);
  await expect(page.getByRole('heading', { name: 'Continue learning' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Continue learning' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Workspace recap' })).toContainText(
    'Paused this topic.',
  );
  await openLearningPath(page);
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

  await openTodayView(page);
  await expect(page.getByRole('heading', { name: 'Continue learning' })).toBeVisible();

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

  await openLearningPath(page);
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

  await openLearningPath(page);
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

  await openSources(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill('Transformers paper');
  await page.getByLabel('Web address').fill('https://arxiv.org/abs/1706.03762');
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: 'Transformers paper' })
      .getByRole('link', { name: 'Open original' }),
  ).toBeVisible();

  await openTodayView(page);
  const research = page.getByRole('button', { name: 'Find sources' });
  await expect(research).toBeVisible();
  await research.click();
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Continue learning' })).toBeVisible();
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
    await page.evaluate(async (title) => {
      const root = await navigator.storage.getDirectory();
      const dusori = await root.getDirectoryHandle('Dusori');
      const topic = await (
        await dusori.getDirectoryHandle('Topics')
      ).getDirectoryHandle('ai-fundamentals');
      const handle = await topic.getFileHandle('roadmap.md');
      const current = await (await handle.getFile()).text();
      const writable = await handle.createWritable();
      await writable.write(`${current.trimEnd()}\n- [ ] ${title}\n`);
      await writable.close();
    }, unbreakableToken);
    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
    await openTodayView(page);
    await expect(page.getByRole('heading', { name: 'Continue learning' })).toBeVisible();
    let dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `Today overflow at ${width}px`).toBe(dimensions.clientWidth);

    await page.getByRole('button', { name: 'Open workspace navigation' }).click();
    await openLearningPath(page);
    await expect(page.getByLabel('Establish the terms and boundaries.')).toBeVisible();
    dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, `Roadmap overflow at ${width}px`).toBe(dimensions.clientWidth);

    const objectiveBleeds = await page
      .locator('.objective-list label > span, .objective-list label > small')
      .evaluateAll((labels) =>
        labels.flatMap((label) => {
          const box = label.getBoundingClientRect();
          const ink = document.createRange();
          ink.selectNodeContents(label);
          const escapes = Array.from(ink.getClientRects()).some(
            (fragment) => fragment.left < box.left - 1 || fragment.right > box.right + 1,
          );
          return escapes ? [label.textContent?.trim() ?? ''] : [];
        }),
      );
    expect(objectiveBleeds, `Roadmap text bleeding at ${width}px`).toEqual([]);
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
  await createTopic(page, { remainInResearch: true });
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dusori Research Desk' })).toBeVisible();
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
  await expect(page.getByRole('navigation', { name: 'Dusori Research Desk' })).toBeVisible();

  // Being visible is not the same as being reachable. The drawer covers the canvas, so focus has
  // to move into it and stay there; otherwise Tab walks through the controls hidden behind it.
  // Scoped to the drawer: the dismiss backdrop carries the same accessible name.
  const drawer = page.getByRole('navigation', { name: 'Dusori Research Desk' });
  await expect(drawer.getByRole('button', { name: 'Close workspace navigation' })).toBeFocused();
  for (let press = 0; press < 6; press += 1) {
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('nav.studio-header'))),
      'focus left the open drawer',
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Dusori Research Desk' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open workspace navigation' })).toBeFocused();

  await page.getByRole('button', { name: 'Open inspector' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Workspace details' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Workspace details' })).toBeHidden();
});

test('captures the required responsive product surfaces', async ({ browser }) => {
  test.setTimeout(120_000);
  await mkdir('test-results/screenshots', { recursive: true });

  for (const width of [375, 1280]) {
    const context: BrowserContext = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 900 },
    });
    const page = await context.newPage();

    await page.goto('/Dusori/');
    await captureAtTop(page, {
      path: `test-results/screenshots/landing-${width}.png`,
      fullPage: true,
    });

    await createBrowserWorkspace(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await captureAtTop(page, {
      path: `test-results/screenshots/workspace-${width}.png`,
      fullPage: true,
    });

    await createTopic(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await captureAtTop(page, {
      path: `test-results/screenshots/note-${width}.png`,
      fullPage: true,
    });

    await addPastedSource(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await captureAtTop(page, {
      path: `test-results/screenshots/sources-${width}.png`,
      fullPage: true,
    });

    await previewCurriculum(page);
    await captureAtTop(page, {
      path: `test-results/screenshots/curriculum-${width}.png`,
      fullPage: true,
    });

    await runConflictProof(page);
    await expect(page.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
    await captureAtTop(page, {
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
  const closeInspector = sitePage.getByRole('button', { name: 'Close workspace details' }).first();
  if (await closeInspector.isVisible()) await closeInspector.click();
  await sitePage.getByLabel('Describe generative AI concepts').check();
  await openTodayView(sitePage);
  await expect(sitePage.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
  await sitePage.screenshot({ path: 'test-results/screenshots/site-workspace-1440.png' });

  const studioNavigation = sitePage.getByRole('navigation', { name: 'Dusori Research Desk' });
  await studioNavigation.getByRole('button', { name: 'Research', exact: true }).click();
  await expect(sitePage.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
  await sitePage.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: 'application/json',
      json:
        url.searchParams.get('list') === 'search'
          ? {
              query: {
                search: [
                  {
                    pageid: 1,
                    size: 5200,
                    snippet: 'How AI attention relates tokens to the rest of their context.',
                    title: 'Attention in machine learning',
                    wordcount: 620,
                  },
                ],
              },
            }
          : {
              query: {
                pages: {
                  '1': {
                    extract:
                      'Attention lets each token weigh the other tokens in its context. The attention mechanism allows every token to weigh the other tokens in context before producing the next representation.\n\n== Multi-head attention ==\n\nMulti-head attention learns several relationships in parallel, which lets different heads emphasize different patterns.\n\n== Transformer layers ==\n\nTransformer layers pair attention with feed-forward transformations and residual connections.',
                    pageid: 1,
                    title: 'Attention in machine learning',
                  },
                },
              },
            },
    });
  });
  await sitePage.getByLabel('Your question').fill('How does attention work?');
  await sitePage.getByRole('button', { name: 'Research and build' }).click();
  const providerDisclosure = sitePage.getByRole('dialog', {
    name: 'Choose where this question may go.',
  });
  await providerDisclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  await providerDisclosure.getByRole('button', { name: 'Save choices and research' }).click();
  await expect(
    sitePage.getByRole('heading', { name: 'One place for the whole investigation.' }),
  ).toBeVisible();
  await expect(sitePage.locator('article.markdown')).toContainText('Assembled on');
  await studioNavigation.getByRole('button', { name: 'Research', exact: true }).click();
  await expect(sitePage.getByRole('list', { name: 'Provider receipt' })).toContainText('Wikipedia');
  await expect(sitePage.getByRole('list', { name: 'Provider receipt' })).toContainText('1 found');
  await sitePage.screenshot({ path: 'test-results/screenshots/app-research.png' });

  await studioNavigation.getByRole('button', { name: /^Sources/u }).click();
  await expect(sitePage.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
  await sitePage.getByRole('button', { name: 'Transformer notes' }).click();
  await expect(sitePage.getByRole('article', { name: 'Reading room' })).toBeVisible();
  await sitePage.screenshot({ path: 'test-results/screenshots/app-reader.png' });

  await studioNavigation.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(sitePage.getByRole('heading', { name: 'Research map' })).toBeVisible();
  await expect(sitePage.getByRole('button', { name: 'Outline', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sitePage.getByRole('button', { name: 'Depth map', exact: true }).click();
  await expect(
    sitePage.getByRole('region', { name: 'Interactive research depth map' }),
  ).toBeVisible();
  await sitePage.screenshot({ fullPage: true, path: 'test-results/screenshots/app-map.png' });
  await siteContext.close();

  const ogContext = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const ogPage = await ogContext.newPage();
  await ogPage.goto('/Dusori/');
  await ogPage.addStyleTag({
    content: `
      .site-nav { position: relative !important; }
      .hero {
        min-height: 0 !important;
        align-items: start !important;
        gap: 3rem !important;
        padding-block: 2.5rem !important;
      }
      .hero-copy { gap: 1rem !important; }
      .hero h1 {
        font-size: 4.4rem !important;
        line-height: 0.94 !important;
      }
      .lede {
        font-size: 1rem !important;
        line-height: 1.4 !important;
      }
      .actions, .trust-line { display: none !important; }
      .hero-stage { padding-block-start: 4rem !important; }
      .app-icon-module {
        transform: scale(0.88);
        transform-origin: top right;
      }
    `,
  });
  const ledeBox = await ogPage.locator('.lede').boundingBox();
  expect(ledeBox, 'social card lede should be rendered').not.toBeNull();
  expect(ledeBox!.y + ledeBox!.height, 'social card lede is clipped').toBeLessThanOrEqual(630);
  await ogPage.screenshot({ path: 'test-results/screenshots/og-dusori.png' });
  await ogContext.close();
});

async function captureAtTop(page: Page, options: Parameters<Page['screenshot']>[0]): Promise<void> {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  await page.screenshot(options);
}

const attentionFetchedPage = {
  fetchedAt: '2026-07-21T00:00:00.000Z',
  finalUrl: 'https://example.org/attention',
  text: `Attention lets each token weigh the other tokens in its context. The attention mechanism allows every token to weigh the other tokens in context before producing the next representation.\n${overflowingLines}`,
  title: 'Attention in transformers',
  truncated: false,
};

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
  await openSources(page);
  await page.getByLabel('Source type').selectOption('url');
  await page.getByLabel('Source title').fill(title);
  await page.getByLabel('Web address').fill(url);
  await page.getByRole('button', { name: 'Save source' }).click();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(title);

  await page.route('**/api/health', async (route) => {
    await route.fulfill({ json: companionHealth });
  });
  await page.reload();
  await expectCompanionConnected(page);
  await openSources(page);
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(title);
}

async function expectCompanionConnected(page: Page): Promise<void> {
  await openInspector(page);
  await expect(page.getByText(/Connected (?:securely )?for this/u)).toBeVisible();
  await page
    .getByRole('complementary', { name: 'Workspace details' })
    .getByRole('button', { name: 'Close workspace details' })
    .click();
}

test.describe('companion flows', () => {
  // The PWA service worker owns same-origin fetches, which prevents Playwright
  // request fixtures from observing the companion calls. Offline behavior has
  // its own test; companion transport tests deliberately exercise the page path.
  test.use({ serviceWorkers: 'block' });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/research/capabilities', async (route) => {
      await route.fulfill({ json: companionResearchCapabilities });
    });
  });

  test('provider setup is distinct from a failed research run', async ({ page }) => {
    await page.unroute('**/api/research/capabilities');
    await page.route('**/api/research/capabilities', async (route) => {
      await route.fulfill({
        json: {
          providers: companionResearchCapabilities.providers.map((provider) =>
            provider.id === 'websearch' || provider.id === 'youtube'
              ? { available: false, id: provider.id, reason: 'not-configured' }
              : provider,
          ),
        },
      });
    });
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ headers: { 'cache-control': 'no-store' }, json: companionHealth });
    });

    await createBrowserWorkspace(page);
    await expectCompanionConnected(page);
    await createTopic(page, { remainInResearch: true });

    await expect(page.getByRole('heading', { name: 'Start with a direction.' })).toBeVisible();
    await page.getByText('Research providers and setup', { exact: true }).click();
    const availability = page.getByRole('list', { name: 'Research provider availability' });
    await expect(
      availability.getByRole('listitem').filter({ hasText: 'Web search' }),
    ).toContainText('Not configured in the local companion');
    await expect(availability.getByRole('listitem').filter({ hasText: 'YouTube' })).toContainText(
      'Not configured in the local companion',
    );
    await expect(page.locator('.provider-summary')).toContainText(/\d+ research providers/u);
    await expect(page.locator('.provider-summary')).toContainText(
      /0\s+allowed now · \d+ need a choice/u,
    );
    await expect(page.getByRole('list', { name: 'Provider outcomes' })).toHaveCount(0);
  });

  test('companion reads a URL source in one action and refreshes the brief', async ({ page }) => {
    const fetchCalls: string[] = [];
    await page.route('**/api/health', async (route) => {
      if (route.request().headers()['authorization'] === 'Bearer e2e-companion-token') {
        await route.fulfill({ json: companionHealth });
      } else {
        await route.fulfill({ status: 401, json: { error: 'unauthorized' } });
      }
    });
    await page.route('**/api/research/fetch', async (route) => {
      fetchCalls.push(route.request().headers()['authorization'] ?? '');
      await route.fulfill({ json: attentionFetchedPage });
    });

    await createBrowserWorkspace(page);
    await createTopic(page);
    await openSources(page);

    await page.getByLabel('Source type').selectOption('url');
    await page.getByLabel('Source title').fill('Attention paper');
    await page.getByLabel('Web address').fill('https://example.org/attention');
    await page.getByRole('button', { name: 'Save source' }).click();
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
      'Attention paper',
    );

    // Without a companion token the upgrade action is absent and the hint shows.
    await expect(page.getByRole('button', { name: 'Read from example.org' })).toHaveCount(0);
    await expect(
      page.getByText('Run the companion (npx @udhawan97/dusori) to fetch full page content.'),
    ).toBeVisible();

    // Reload as if served by the same-origin companion session.
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    await page.reload();
    await expectCompanionConnected(page);
    await openSources(page);
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
      'Attention paper',
    );

    await page.getByRole('button', { name: 'Read from example.org' }).click();
    await expect(
      page.getByRole('article', { name: 'Reading room' }).locator('#reading-room-title'),
    ).toBeVisible();
    await expect(page.getByRole('article', { name: 'Reading room' })).toContainText(
      'weigh the other tokens',
    );
    expect(fetchCalls).toEqual(['']);
    const manifest = await readWorkspaceFile(page, 'Topics/ai-fundamentals/Sources/manifest.json');
    expect(manifest).toContain('page-extract');
    const synthesis = await waitForWorkspaceFile(page, 'Topics/ai-fundamentals/Synthesis.md');
    expect(synthesis).toContain('Attention paper');
    expect(synthesis).toContain('weigh the other tokens');
    await expectNoSeriousA11yViolations(page);
  });

  test('an access-denied page keeps a durable browser fallback', async ({ page }) => {
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    const failure =
      'This page answered with status 401. Dusori kept the reference; open the original in your browser or paste the text instead.';
    await page.route('**/api/research/fetch', async (route) => {
      await route.fulfill({
        json: { error: failure, reason: 'access-denied', status: 401 },
        status: 401,
      });
    });
    await addUrlSourceAndConnectCompanion(page, 'Attention paper', 'https://example.org/attention');

    await page.getByRole('button', { name: 'Read from example.org' }).click();
    await expect(page.getByRole('alert')).toContainText('status 401');
    const source = page
      .locator('.source-list [role="listitem"]')
      .filter({ hasText: 'Attention paper' });
    await expect(source).toContainText(failure);
    await expect(source.getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'href',
      'https://example.org/attention',
    );

    await page.reload();
    await openSources(page);
    await expect(
      page.locator('.source-list [role="listitem"]').filter({ hasText: 'Attention paper' }),
    ).toContainText('status 401');
  });

  test('companion launch credentials are consumed and health proves the service contract', async ({
    context,
    page,
  }) => {
    await createBrowserWorkspace(page);
    await createTopic(page);
    const appOrigin = new URL(page.url()).origin;

    const deniedPage = await context.newPage();
    await deniedPage.route('**/api/health', async (route) => {
      await route.fulfill({ body: '<html>static fallback</html>', contentType: 'text/html' });
    });
    await deniedPage.goto(
      `/Dusori/app/?token=visible-secret&companion=${encodeURIComponent(appOrigin)}&topic=ai-fundamentals&view=graph`,
    );
    await openInspector(deniedPage);
    expect(deniedPage.url()).not.toContain('token=');
    expect(deniedPage.url()).not.toContain('companion=');
    expect(deniedPage.url()).toContain('topic=ai-fundamentals');
    expect(deniedPage.url()).toContain('view=graph');
    await deniedPage.close();

    let authorization = '';
    const connectedPage = await context.newPage();
    await connectedPage.route('**/api/health', async (route) => {
      authorization = route.request().headers()['authorization'] ?? '';
      await route.fulfill({ headers: { 'cache-control': 'no-store' }, json: companionHealth });
    });
    await connectedPage.goto(
      `/Dusori/app/?token=e2e-companion-token&companion=${encodeURIComponent(appOrigin)}`,
    );
    await expect.poll(() => authorization).toBe('Bearer e2e-companion-token');
    await expectCompanionConnected(connectedPage);
    expect(connectedPage.url()).not.toContain('token=');
    expect(connectedPage.url()).not.toContain('companion=');
    await connectedPage.close();
  });

  test('a source can leave active research and be restored after reload', async ({ page }) => {
    await createBrowserWorkspace(page);
    await createTopic(page);
    await addPastedSource(page);

    const source = page.getByRole('listitem').filter({ hasText: 'Transformer notes' });
    await source.getByRole('button', { name: 'Remove from research' }).click();
    await expect(
      page.getByText(/Transformer notes was removed from active research/u),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Saved sources' })).toHaveCount(0);

    const navigation = page.getByRole('navigation', { name: 'Dusori Research Desk' });
    await navigation.getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Research map' })).toBeVisible();
    await expect(page.locator('.graph-ledger > div').filter({ hasText: 'Sources' })).toContainText(
      '0',
    );
    await page.getByRole('button', { name: 'Depth map', exact: true }).click();
    const progress = page.locator(
      '.evidence-spine[aria-label="AI Fundamentals research progress"]',
    );
    await expect(progress.getByRole('definition').nth(1)).toHaveText('0');

    await page.reload();
    await openSources(page);
    const removed = page.locator('details.removed-sources');
    await removed.getByText('1 removed source', { exact: true }).click();
    await removed.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
      'Transformer notes',
    );
    await page
      .getByRole('navigation', { name: 'Dusori Research Desk' })
      .getByRole('button', { name: 'Map', exact: true })
      .click();
    await expect(page.locator('.graph-ledger > div').filter({ hasText: 'Sources' })).toContainText(
      '1',
    );
  });

  test('YouTube research saves metadata only and never asks for captions', async ({ page }) => {
    const googleRequests: string[] = [];
    const transcriptRequests: string[] = [];
    page.on('request', (request) => {
      const host = new URL(request.url()).host;
      if (/youtube\.com|ytimg\.com|googlevideo\.com|google\.com/u.test(host)) {
        googleRequests.push(request.url());
      }
    });
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ headers: { 'cache-control': 'no-store' }, json: companionHealth });
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
              summary: 'A walk through attention in AI systems.',
              title: 'How attention works',
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              viewCount: 1_200_000,
            },
          ],
        },
      });
    });
    await page.route('**/api/research/youtube-transcript**', async (route) => {
      transcriptRequests.push(route.request().url());
      await route.fulfill({ status: 410, json: { reason: 'transcript-requires-user-supplied' } });
    });

    await createBrowserWorkspace(page);
    await expectCompanionConnected(page);
    await createTopic(page, { remainInResearch: true });
    await page.getByLabel('Your question').fill('How attention works');
    await page.getByRole('button', { name: 'Research and build' }).click();
    const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
    for (const checkbox of await disclosure.getByRole('checkbox').all()) {
      const label = await checkbox.evaluate((input) => input.closest('label')?.textContent ?? '');
      if (label.includes('YouTube')) await checkbox.check();
    }
    await disclosure.getByRole('button', { name: 'Save choices and research' }).click();

    await openSources(page);
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
      'How attention works',
    );
    await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText('URL reference');
    const savedVideo = page
      .getByRole('region', { name: 'Saved sources' })
      .locator('.source-list [role="listitem"]')
      .filter({ hasText: 'How attention works' });
    await expect(savedVideo.getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    );
    await expect(savedVideo.getByRole('link', { name: 'Open original' })).toHaveAttribute(
      'target',
      '_blank',
    );
    const manifest = await readWorkspaceFile(page, 'Topics/ai-fundamentals/Sources/manifest.json');
    expect(manifest).toContain('"provider": "youtube"');
    expect(manifest).toContain('"capturedVia": "youtube-reference"');
    expect(manifest).toContain('"readState": "reference"');
    expect(transcriptRequests).toEqual([]);
    expect(googleRequests).toEqual([]);
  });

  test('Settings distinguishes a failed local model from a configured hosted provider', async ({
    page,
  }) => {
    await page.route('**/api/health', async (route) => {
      await route.fulfill({ json: companionHealth });
    });
    await page.route('**/api/ai/capabilities', async (route) => {
      await route.fulfill({
        json: {
          providers: [{ id: 'ollama', model: 'gemma4:12b-it-qat', status: 'model-failed' }],
        },
      });
    });
    await createBrowserWorkspace(page);
    await expectCompanionConnected(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByText(/is installed, but it did not pass/u)).toBeVisible();
    await expect(page.locator('.ai-ready')).toHaveCount(0);

    await page.unroute('**/api/ai/capabilities');
    await page.route('**/api/ai/capabilities', async (route) => {
      await route.fulfill({
        json: {
          providers: [{ id: 'ollama', model: 'older-companion-model' }],
        },
      });
    });
    await page.getByRole('button', { name: 'Check AI setup' }).click();
    await expect(page.getByText(/was detected in Ollama, but has not passed/u)).toBeVisible();
    await expect(page.getByText(/configured through hosted provider/u)).toHaveCount(0);

    await page.unroute('**/api/ai/capabilities');
    await page.route('**/api/ai/capabilities', async (route) => {
      await route.fulfill({
        json: {
          providers: [{ id: 'openai', model: 'gpt-4o-mini', status: 'configured' }],
        },
      });
    });
    await page.getByRole('button', { name: 'Check AI setup' }).click();
    await expect(
      page.getByRole('heading', { name: 'Use the hosted provider you configured' }),
    ).toBeVisible();
    await expect(page.getByText(/This is not a model on this computer/u)).toBeVisible();
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
    await expectCompanionConnected(page);

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
    [320, 568],
    [320, 800],
    [375, 667],
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
    [414, 896],
  ]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await createBrowserWorkspace(page);
    await createTopic(page, { remainInResearch: true });

    await expectWithinFold(page, page.getByLabel('Your question'), 'the research question');
    await expectWithinFold(
      page,
      page.getByRole('button', { name: 'Research and build' }),
      `the research action at ${width}×${height}`,
    );

    const dimensions = await page.evaluate(() => {
      const panel = document.querySelector('.research-workspace')?.getBoundingClientRect();
      return {
        bodyWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        panelRight: panel?.right ?? Number.POSITIVE_INFINITY,
        rootWidth: document.documentElement.scrollWidth,
      };
    });
    expect(dimensions.rootWidth, `root overflow at ${width}px`).toBe(dimensions.clientWidth);
    expect(dimensions.bodyWidth, `body overflow at ${width}px`).toBe(dimensions.clientWidth);
    expect(
      Math.ceil(dimensions.panelRight),
      `research panel clipping at ${width}px`,
    ).toBeLessThanOrEqual(width);

    // The creation toast lands over that same region. It announces; it must not absorb a click.
    await expect(page.getByText('Topic created.')).toBeVisible();
    await page.getByRole('button', { name: 'Research and build' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Choose where this question may go.' }),
    ).toBeVisible();
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
  // Topic creation auto-opens the consent sheet. Dismissing it returns focus to the action that
  // opened it; subsequent primary-navigation changes still orient to their own heading.
  await expect(page.getByRole('button', { name: 'Research and build' })).toBeFocused();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await openTodayView(page);

  const heading = page.getByRole('heading', { name: 'Continue learning' });
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
  const rail = page.getByRole('navigation', { name: 'Dusori Research Desk' });
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
    page.getByRole('heading', { name: 'Keep the whole investigation together.' }),
  ).toBeVisible();
  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  if (await disclosure.isVisible()) {
    await disclosure.getByRole('button', { name: 'Decide later' }).click();
  }

  const icons = await page.evaluate(() =>
    [...document.querySelectorAll('.studio-header .topic-list .studio-link')].map((link) => {
      const label = link.querySelector('.studio-link-label');
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

test('postponing the grouped provider disclosure records no decision', async ({ page }) => {
  await createBrowserWorkspace(page);
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();

  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await expect(disclosure).toBeVisible();
  await expect(disclosure).toContainText('Choices stay separately on this device');
  expect(await disclosure.getByRole('checkbox').count()).toBeGreaterThan(1);
  await expect(disclosure.getByRole('checkbox').first()).not.toBeChecked();
  await expect(disclosure.getByRole('checkbox').first()).toBeFocused();
  await disclosure.getByRole('button', { name: 'Decide later' }).click();

  await page.getByRole('button', { name: 'Research and build' }).click();
  await expect(disclosure).toBeVisible();
  await expect(disclosure.getByRole('checkbox').first()).not.toBeChecked();
});

test('question-shaped consent keeps actions visible, traps focus, and makes no request before allow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const providerHosts = new Set([
    'api.crossref.org',
    'api.github.com',
    'api.openalex.org',
    'api.stackexchange.com',
    'en.wikipedia.org',
    'hn.algolia.com',
    'learn.microsoft.com',
    'openlibrary.org',
    'registry.npmjs.org',
    'www.ebi.ac.uk',
    'www.loc.gov',
  ]);
  const providerRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (providerHosts.has(url.hostname)) providerRequests.push(url.hostname);
  });
  await page.route('https://en.wikipedia.org/w/api.php**', async (route) => {
    await route.fulfill({ contentType: 'application/json', json: { query: { search: [] } } });
  });

  await createBrowserWorkspace(page);
  await page
    .getByLabel('Topic name')
    .fill('Microsoft TypeScript clinical cultural heritage archives');
  await page.getByRole('button', { name: 'Create topic' }).click();

  const trigger = page.getByRole('button', { name: 'Research and build' });
  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  const actions = disclosure.locator('.dialog-actions');
  const providerList = disclosure.locator('.consent-scroll');
  await expect(disclosure).toBeVisible();
  await expect(disclosure.getByRole('button', { name: 'Decide later' })).toBeVisible();
  await expect(disclosure.getByRole('button', { name: 'Keep all off' })).toBeVisible();
  await expect(disclosure.getByRole('button', { name: 'Save choices and research' })).toBeVisible();
  expect(await disclosure.getByRole('checkbox').count()).toBe(11);
  const geometry = await disclosure.evaluate((dialog) => {
    const footer = dialog.querySelector('.dialog-actions')?.getBoundingClientRect();
    const list = dialog.querySelector('.consent-scroll');
    return {
      clientHeight: dialog.clientHeight,
      footerBottom: footer?.bottom ?? Number.POSITIVE_INFINITY,
      footerTop: footer?.top ?? Number.NEGATIVE_INFINITY,
      listClientHeight: list?.clientHeight ?? 0,
      listScrollHeight: list?.scrollHeight ?? 0,
      overflowY: getComputedStyle(dialog).overflowY,
      scrollHeight: dialog.scrollHeight,
    };
  });
  expect(geometry.overflowY).toBe('hidden');
  expect(geometry.footerTop).toBeGreaterThan(0);
  expect(geometry.footerBottom).toBeLessThanOrEqual(568);
  expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight);
  await expect(actions).toBeInViewport();
  await expect(providerList).toBeInViewport();

  const firstChoice = disclosure.getByRole('checkbox').first();
  await expect(firstChoice).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(disclosure.getByRole('button', { name: 'Select recommended' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstChoice).toBeFocused();
  expect(providerRequests).toEqual([]);

  await page.mouse.click(2, 2);
  await expect(disclosure).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(providerRequests).toEqual([]);
  expect(
    await page.evaluate(
      () =>
        Object.keys(localStorage).filter((key) => key.startsWith('dusori-research-consent:v2:'))
          .length,
    ),
  ).toBe(0);

  await trigger.click();
  await expect(disclosure.getByRole('checkbox').first()).not.toBeChecked();
  await disclosure.getByRole('button', { name: 'Decide later' }).click();
  await expect(trigger).toBeFocused();
  expect(providerRequests).toEqual([]);

  await trigger.click();
  await expect(disclosure).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(disclosure).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(providerRequests).toEqual([]);

  await trigger.click();
  await disclosure.getByRole('button', { name: 'Keep all off' }).click();
  await expect(disclosure).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(providerRequests).toEqual([]);

  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('dusori-research-consent:v2:')) localStorage.removeItem(key);
    }
  });
  await trigger.click();
  await disclosure.getByRole('checkbox', { name: /^Wikipedia/u }).check();
  expect(providerRequests).toEqual([]);
  await disclosure.getByRole('button', { name: 'Save choices and research' }).click();
  await expect(disclosure).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText(/no relevant sources/iu)).toBeVisible();
  expect(providerRequests).toEqual(['en.wikipedia.org']);

  await page.getByText('Research providers and setup').click();
  await expect(page.getByRole('list', { name: 'Research provider availability' })).toContainText(
    'Europe PMC',
  );
  await expect(page.getByRole('list', { name: 'Research provider availability' })).toContainText(
    'Library of Congress',
  );
});

test('provider consent reflows for 200% zoom, provider growth, and a shorter dynamic viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await createBrowserWorkspace(page);
  await page
    .getByLabel('Topic name')
    .fill('Microsoft TypeScript clinical cultural heritage archives');
  await page.getByRole('button', { name: 'Create topic' }).click();

  const disclosure = page.getByRole('dialog', { name: 'Choose where this question may go.' });
  await expect(disclosure).toBeVisible();
  expect(await disclosure.getByRole('checkbox').count()).toBe(11);

  await disclosure.evaluate((dialog) => {
    const list = dialog.querySelector('.consent-scroll ul');
    const template = list?.querySelector('li');
    if (!list || !template) throw new Error('Consent provider list is unavailable.');
    for (let index = 0; index < 16; index += 1) {
      const clone = template.cloneNode(true) as HTMLElement;
      const label = clone.querySelector('strong');
      if (label) label.textContent = `Future provider ${index + 1}`;
      list.append(clone);
    }
  });

  // Chromium browser zoom reduces the layout viewport in CSS pixels. 160x284 is the 200%
  // zoom-equivalent of the audited 320x568 surface, without relying on OS-specific shortcuts.
  await page.setViewportSize({ width: 160, height: 284 });

  const readGeometry = () =>
    disclosure.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const footer = dialog.querySelector('.dialog-actions')?.getBoundingClientRect();
      const list = dialog.querySelector('.consent-scroll');
      return {
        clientHeight: dialog.clientHeight,
        clientWidth: dialog.clientWidth,
        dialogBottom: rect.bottom,
        dialogLeft: rect.left,
        dialogRight: rect.right,
        dialogTop: rect.top,
        footerBottom: footer?.bottom ?? Number.POSITIVE_INFINITY,
        footerTop: footer?.top ?? Number.NEGATIVE_INFINITY,
        innerHeight: window.innerHeight,
        innerWidth: window.innerWidth,
        listClientHeight: list?.clientHeight ?? 0,
        listOverflowY: list ? getComputedStyle(list).overflowY : '',
        listScrollHeight: list?.scrollHeight ?? 0,
        overflowY: getComputedStyle(dialog).overflowY,
        scrollHeight: dialog.scrollHeight,
        scrollWidth: dialog.scrollWidth,
      };
    });

  for (const height of [284, 240]) {
    if (height !== 284) await page.setViewportSize({ width: 160, height });
    const geometry = await readGeometry();
    expect(geometry.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.dialogRight).toBeLessThanOrEqual(geometry.innerWidth);
    expect(geometry.dialogTop).toBeGreaterThanOrEqual(0);
    expect(geometry.dialogBottom).toBeLessThanOrEqual(geometry.innerHeight);
    expect(geometry.overflowY).toBe('hidden');
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.scrollHeight).toBeLessThanOrEqual(geometry.clientHeight);
    expect(geometry.footerTop).toBeGreaterThan(geometry.dialogTop);
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.dialogBottom);
    expect(geometry.listOverflowY).toBe('auto');
    expect(geometry.listClientHeight).toBeGreaterThan(0);
    expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight);
    await expect(disclosure.locator('.dialog-actions')).toBeInViewport();
  }
});

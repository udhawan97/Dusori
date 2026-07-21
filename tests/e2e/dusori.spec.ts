import { mkdir } from 'node:fs/promises';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

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
  await expect(page.getByRole('heading', { name: 'Create your first topic.' })).toBeVisible();
}

async function createTopic(page: Page): Promise<void> {
  await page.getByLabel('Topic name').fill('AI Fundamentals');
  await page.getByRole('button', { name: 'Create topic' }).click();
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

async function addPastedSource(page: Page): Promise<void> {
  if (!(await page.getByRole('heading', { name: 'Sources' }).isVisible())) {
    await page.getByRole('button', { name: 'Open inspector' }).click();
  }
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
  await expect(page.locator('.note-sheet').getByRole('heading', { name: 'Roadmap' })).toBeVisible();
  await expect(page.locator('.note-sheet')).toContainText('Identify AI concepts and capabilities');
  await expect(page.getByRole('heading', { name: 'Curriculum ready.' })).toBeVisible();
}

test('landing, setup, workspace, note, and conflict screens are accessible', async ({ page }) => {
  await page.goto('/Dusori/');
  await expect(
    page.getByRole('heading', { name: 'Your learning files. Still yours.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /open the app/iu })).toHaveAttribute(
    'href',
    '/Dusori/app/',
  );
  await expect(page.getByRole('link', { name: /read the documentation/iu })).toHaveAttribute(
    'href',
    '/Dusori/docs/',
  );
  await expectNoSeriousA11yViolations(page);

  await page.goto('/Dusori/docs/');
  await expect(page.getByRole('heading', { name: 'Dusori documentation' })).toBeVisible();
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
  await expect(page.locator('.note-sheet').getByRole('heading', { name: 'Roadmap' })).toBeVisible();
  await expect(page.locator('.note-sheet')).toContainText('Describe responsible AI considerations');
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
  await expectNoSeriousA11yViolations(page);

  const roadmap = await page.evaluate(async () => {
    const origin = await navigator.storage.getDirectory();
    const root = await origin.getDirectoryHandle('Dusori');
    const topics = await root.getDirectoryHandle('Topics');
    const topic = await topics.getDirectoryHandle('ai-fundamentals');
    return (await (await topic.getFileHandle('roadmap.md')).getFile()).text();
  });
  expect(await roadmap).toContain('This first roadmap is deliberately manual.');
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
  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await expect(page.locator('.note-sheet')).toContainText('Keep this direction.');

  await page.getByRole('button', { name: 'Use imported roadmap' }).click();
  await expect(page.locator('.note-sheet')).toContainText('Identify AI concepts and capabilities');
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

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('aside input[type="file"]').setInputFiles(archive!);
  await expect(page.getByRole('heading', { name: 'First look at AI Fundamentals' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Transformer notes',
  );
  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await expect(page.locator('.note-sheet')).toContainText('Identify AI concepts and capabilities');
  await expect(page.getByText('Workspace imported and schema-checked.')).toBeVisible();
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

test('the installed shell reloads and remains usable offline', async ({ page, context }) => {
  await createBrowserWorkspace(page);
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Create your first topic.' })).toBeVisible();
  await createTopic(page);
  await expect(page.getByRole('heading', { name: 'First look at AI Fundamentals' })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Create your first topic.' })).toBeVisible();

  await page.getByRole('button', { name: 'Open workspace navigation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeHidden();

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
  await previewCurriculum(sitePage);
  await sitePage.locator('.curriculum-slot').scrollIntoViewIfNeeded();
  await expect(sitePage.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
  await sitePage.screenshot({ path: 'test-results/screenshots/site-workspace-1440.png' });
  await siteContext.close();
});

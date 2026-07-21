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

const microsoftLearnCatalog = {
  modules: [
    {
      duration_in_minutes: 18,
      levels: ['beginner'],
      popularity: 0.92,
      products: ['azure-active-directory'],
      summary: 'Learn the terms and boundaries of Microsoft Entra identity management.',
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
  await expect(page.locator('.learning-loop')).toContainText(
    'Identify AI concepts and capabilities',
  );
  await expect(page.getByRole('heading', { name: 'Curriculum ready.' })).toBeVisible();
}

test('landing, setup, workspace, note, and conflict screens are accessible', async ({ page }) => {
  await page.goto('/Dusori/');
  await expect(page.getByRole('heading', { name: 'Learn deeply. Keep the files.' })).toBeVisible();
  await expect(page.getByRole('link', { name: /open dusori/iu })).toHaveAttribute(
    'href',
    '/Dusori/app/',
  );
  await expect(page.getByRole('link', { name: /read the docs/iu })).toHaveAttribute(
    'href',
    '/Dusori/docs/',
  );
  await expect(page.getByText('v0.1.0 · available now', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /release notes/iu })).toHaveAttribute(
    'href',
    'https://github.com/udhawan97/Dusori/releases/tag/v0.1.0',
  );
  await expectNoSeriousA11yViolations(page);

  await page.goto('/Dusori/docs/');
  await expect(page.getByRole('heading', { name: 'Dusori documentation' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: /v0\.1\.0 release notes/iu }).first(),
  ).toHaveAttribute('href', './releases/v0-1-0/');
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
  expect((await identity.boundingBox())?.width).toBeGreaterThan(360);
  await expect(
    page.getByRole('heading', { name: 'Your notes, finally on speaking terms.' }),
  ).toBeVisible();
  await expect(page.getByText('Japanese restraint · Indian geometry')).toBeVisible();

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
  await expect(page.getByRole('complementary', { name: 'Workspace details' })).toBeHidden();
  const graph = page.getByRole('group', { name: 'Workspace knowledge graph' });
  await expect(graph).toBeVisible();
  await expect(page.getByRole('list', { name: 'Graph documents' })).toContainText('First look');
  await expect(page.getByText(/6 artifacts · \d+ connections/u)).toBeVisible();

  const hub = graph.getByRole('button', { name: /AI Fundamentals, overview, \d+ wikilinks, hub/u });
  await expect(hub).toHaveClass(/hub/u);

  for (let tabCount = 0; tabCount < 20; tabCount += 1) {
    if (await page.locator('.node:focus').count()) break;
    await page.keyboard.press('Tab');
  }
  const focusedNode = page.locator('.node:focus');
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
  await createTopic(page);

  await expect(page.getByRole('heading', { name: 'Research' })).toBeVisible();
  await expect(page.getByLabel('Research objective')).toHaveValue('0');
  const searchMicrosoftLearn = page.getByRole('button', { name: 'Search Microsoft Learn' });
  await searchMicrosoftLearn.click();
  expect(catalogRequests).toBe(0);

  let disclosure = page.getByRole('dialog', { name: 'Allow Microsoft Learn search?' });
  await expect(disclosure).toContainText(
    "Searching sends this objective's text to Microsoft Learn (learn.microsoft.com) over HTTPS. Nothing else from your workspace is sent. Allow on this device?",
  );
  await disclosure.getByRole('button', { name: 'Keep search off' }).click();
  await expect(searchMicrosoftLearn).toBeFocused();
  expect(catalogRequests).toBe(0);

  await searchMicrosoftLearn.click();
  disclosure = page.getByRole('dialog', { name: 'Allow Microsoft Learn search?' });
  await disclosure.getByRole('button', { name: 'Allow search' }).click();
  await expect(page.getByText('Establish identity terms with Microsoft Entra')).toBeVisible();
  expect(catalogRequests).toBe(1);

  const result = page
    .getByRole('list', { name: 'Research suggestions' })
    .getByRole('listitem')
    .filter({ hasText: 'Establish identity terms with Microsoft Entra' });
  await result.getByRole('button', { name: 'Preview' }).click();
  let preview = page.getByRole('dialog', { name: 'Preview research source' });
  await expect(preview.getByText('Source markdown')).toBeVisible();
  await expect(preview.locator('pre')).toContainText(
    '# Establish identity terms with Microsoft Entra',
  );
  await preview.getByRole('button', { name: 'Close preview', exact: true }).first().click();
  await expect(result.getByRole('button', { name: 'Preview' })).toBeFocused();

  await result.getByRole('button', { name: 'Preview' }).click();
  preview = page.getByRole('dialog', { name: 'Preview research source' });
  await preview.getByRole('button', { name: 'Add to sources' }).click();

  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Establish identity terms with Microsoft Entra',
  );
  expect(await page.evaluate(() => localStorage.getItem('dusori-research-consent:mslearn'))).toBe(
    'allowed',
  );
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
  await createTopic(page);

  await page.getByRole('button', { name: 'Search Wikipedia' }).click();
  const disclosure = page.getByRole('dialog', { name: 'Allow Wikipedia search?' });
  await disclosure.getByRole('button', { name: 'Allow search' }).click();
  const result = page
    .getByRole('list', { name: 'Research suggestions' })
    .getByRole('listitem')
    .filter({ hasText: 'Microsoft Entra Connect' });
  await result.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeHidden();

  await page.reload();
  await page.getByRole('button', { name: 'Search Wikipedia' }).click();
  await expect(page.getByText('No suggestions matched this objective.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Microsoft Entra Connect' })).toBeHidden();
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

  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('aside input[type="file"]').setInputFiles(archive!);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Saved sources' })).toContainText(
    'Transformer notes',
  );
  await page.getByRole('button', { name: 'Roadmap', exact: true }).click();
  await expect(page.locator('.learning-loop')).toContainText(
    'Identify AI concepts and capabilities',
  );
  await expect(page.getByText('Workspace imported and schema-checked.')).toBeVisible();
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
      .getByLabel('Today')
      .getByText('Explain the central mechanism in your own words.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Paused this topic.')).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await expect(page.getByText('Paused this topic.')).toBeVisible();
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
  await applyCurriculum(sitePage);
  await sitePage.getByLabel('Describe generative AI concepts').check();
  await sitePage.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(sitePage.locator('.mobile-status')).toBeHidden({ timeout: 5_000 });
  await sitePage.screenshot({ path: 'test-results/screenshots/site-workspace-1440.png' });
  await siteContext.close();
});

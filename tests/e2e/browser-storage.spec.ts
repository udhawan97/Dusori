import { expect, test } from '@playwright/test';

test('the browser workspace survives reload in every supported engine project', async ({
  browserName,
  page,
}) => {
  await page.goto('/Dusori/app/');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(
    page.getByRole('heading', { name: 'What do you want to understand?' }),
  ).toBeVisible();
  await page.getByLabel('Topic name').fill('Engine storage check');
  await page.getByRole('button', { name: 'Create topic' }).click();
  await page
    .getByRole('dialog', { name: 'Choose where this question may go.' })
    .getByRole('button', { name: 'Decide later' })
    .click();

  const backend = await page.evaluate(() =>
    localStorage.getItem('dusori-browser-storage-backend:v1'),
  );
  expect(backend).toMatch(/^(indexeddb|opfs)$/u);
  if (browserName === 'firefox') expect(backend).toBe('indexeddb');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Research this topic' })).toBeVisible();
  await expect(page.getByText('Engine storage check', { exact: true }).first()).toBeVisible();
});

import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import payload from '../../src';
import { AdminUrlUtil } from '../helpers/adminUrlUtil';
import { initPayloadE2E } from '../helpers/configHelpers';
import { login, saveDocAndAssert } from '../helpers';
import type { Post } from './config';
import { globalSlug, slug } from './shared';
import { mapAsync } from '../../src/utilities/mapAsync';
import wait from '../../src/utilities/wait';

const { afterEach, beforeAll, beforeEach, describe } = test;

const title = 'title';
const description = 'description';

let url: AdminUrlUtil;

describe('admin', () => {
  let page: Page;

  beforeAll(async ({ browser }) => {
    const { serverURL } = await initPayloadE2E(__dirname);
    await clearDocs(); // Clear any seeded data from onInit
    url = new AdminUrlUtil(serverURL, slug);

    const context = await browser.newContext();
    page = await context.newPage();

    await login({ page, serverURL });
  });

  afterEach(async () => {
    await clearDocs();
  });

  describe('Nav', () => {
    test('should nav to collection - sidebar', async () => {
      await page.goto(url.admin);
      const collectionLink = page.locator(`#nav-${slug}`);
      await collectionLink.click();

      expect(page.url()).toContain(url.list);
    });

    test('should nav to a global - sidebar', async () => {
      await page.goto(url.admin);
      await page.locator(`#nav-global-${globalSlug}`).click();

      expect(page.url()).toContain(url.global(globalSlug));
    });

    test('should navigate to collection - card', async () => {
      await page.goto(url.admin);
      await page.locator(`#card-${slug}`).click();
      expect(page.url()).toContain(url.list);
    });

    test('breadcrumbs - from list to dashboard', async () => {
      await page.goto(url.list);
      await page.locator('.step-nav a[href="/admin"]').click();
      expect(page.url()).toContain(url.admin);
    });

    test('breadcrumbs - from document to collection', async () => {
      const { id } = await createPost();

      await page.goto(url.edit(id));
      await page.locator(`.step-nav >> text=${slug}`).click();
      expect(page.url()).toContain(url.list);
    });
  });

  describe('CRUD', () => {
    test('should create', async () => {
      await page.goto(url.create);
      await page.locator('#field-title').fill(title);
      await page.locator('#field-description').fill(description);
      await page.click('#action-save', { delay: 100 });

      await saveDocAndAssert(page);

      await expect(page.locator('#field-title')).toHaveValue(title);
      await expect(page.locator('#field-description')).toHaveValue(description);
    });

    test('should read existing', async () => {
      const { id } = await createPost();

      await page.goto(url.edit(id));

      await expect(page.locator('#field-title')).toHaveValue(title);
      await expect(page.locator('#field-description')).toHaveValue(description);
    });

    test('should update existing', async () => {
      const { id } = await createPost();

      await page.goto(url.edit(id));

      const newTitle = 'new title';
      const newDesc = 'new description';
      await page.locator('#field-title').fill(newTitle);
      await page.locator('#field-description').fill(newDesc);

      await saveDocAndAssert(page);

      await expect(page.locator('#field-title')).toHaveValue(newTitle);
      await expect(page.locator('#field-description')).toHaveValue(newDesc);
    });

    test('should delete existing', async () => {
      const { id } = await createPost();

      await page.goto(url.edit(id));
      await page.locator('#action-delete').click();
      await page.locator('#confirm-delete').click();

      await expect(page.locator(`text=Post "${id}" successfully deleted.`)).toBeVisible();
      expect(page.url()).toContain(url.list);
    });

    test('should save globals', async () => {
      await page.goto(url.global(globalSlug));

      await page.locator('#field-title').fill(title);
      await page.click('#action-save', { delay: 100 });

      await expect(page.locator('.Toastify__toast--success')).toHaveCount(1);
      await expect(page.locator('#field-title')).toHaveValue(title);
    });
  });

  describe('list view', () => {
    const tableRowLocator = 'table >> tbody >> tr';

    beforeEach(async () => {
      await page.goto(url.list);
    });

    describe('filtering', () => {
      test('search by id', async () => {
        const { id } = await createPost();
        await page.locator('.search-filter__input').fill(id);
        const tableItems = page.locator(tableRowLocator);
        await expect(tableItems).toHaveCount(1);
      });

      test('toggle columns', async () => {
        const columnCountLocator = 'table >> thead >> tr >> th';
        await createPost();
        await page.locator('.list-controls__toggle-columns').click();
        await wait(1000); // Wait for column toggle UI, should probably use waitForSelector

        const numberOfColumns = await page.locator(columnCountLocator).count();
        const idButton = page.locator('.column-selector >> text=ID');

        // Remove ID column
        await idButton.click({ delay: 100 });
        await expect(page.locator(columnCountLocator)).toHaveCount(numberOfColumns - 1);

        // Add back ID column
        await idButton.click({ delay: 100 });
        await expect(page.locator(columnCountLocator)).toHaveCount(numberOfColumns);
      });

      test('filter rows', async () => {
        const { id } = await createPost({ title: 'post1' });
        await createPost({ title: 'post2' });

        await expect(page.locator(tableRowLocator)).toHaveCount(2);

        await page.locator('.list-controls__toggle-where').click();
        await wait(1000); // Wait for column toggle UI, should probably use waitForSelector

        await page.locator('.where-builder__add-first-filter').click();

        const operatorField = page.locator('.condition__operator');
        const valueField = page.locator('.condition__value >> input');

        await operatorField.click();

        const dropdownOptions = operatorField.locator('.rs__option');
        await dropdownOptions.locator('text=equals').click();

        await valueField.fill(id);
        await wait(1000);

        await expect(page.locator(tableRowLocator)).toHaveCount(1);
        const firstId = await page.locator(tableRowLocator).first().locator('td').first()
          .innerText();
        expect(firstId).toEqual(id);

        // Remove filter
        await page.locator('.condition__actions-remove').click();
        await wait(1000);
        await expect(page.locator(tableRowLocator)).toHaveCount(2);
      });
    });

    describe('pagination', () => {
      beforeAll(async () => {
        await mapAsync([...Array(11)], async () => {
          await createPost();
        });
      });

      test('should paginate', async () => {
        const pageInfo = page.locator('.collection-list__page-info');
        const perPage = page.locator('.per-page');
        const paginator = page.locator('.paginator');
        const tableItems = page.locator(tableRowLocator);

        await expect(tableItems).toHaveCount(10);
        await expect(pageInfo).toHaveText('1-10 of 11');
        await expect(perPage).toContainText('Per Page: 10');

        // Forward one page and back using numbers
        await paginator.locator('button').nth(1).click();
        expect(page.url()).toContain('?page=2');
        await expect(tableItems).toHaveCount(1);
        await paginator.locator('button').nth(0).click();
        expect(page.url()).toContain('?page=1');
        await expect(tableItems).toHaveCount(10);
      });
    });

    // TODO: Troubleshoot flaky suite
    describe.skip('sorting', () => {
      beforeAll(async () => {
        await createPost();
        await createPost();
      });

      test('should sort', async () => {
        const upChevron = page.locator('#heading-id .sort-column__asc');
        const downChevron = page.locator('#heading-id .sort-column__desc');

        const firstId = await page.locator('.row-1 .cell-id').innerText();
        const secondId = await page.locator('.row-2 .cell-id').innerText();

        await upChevron.click({ delay: 200 });

        // Order should have swapped
        expect(await page.locator('.row-1 .cell-id').innerText()).toEqual(secondId);
        expect(await page.locator('.row-2 .cell-id').innerText()).toEqual(firstId);

        await downChevron.click({ delay: 200 });

        // Swap back
        expect(await page.locator('.row-1 .cell-id').innerText()).toEqual(firstId);
        expect(await page.locator('.row-2 .cell-id').innerText()).toEqual(secondId);
      });
    });
  });
});

async function createPost(overrides?: Partial<Post>): Promise<Post> {
  return payload.create<Post>({
    collection: slug,
    data: {
      title,
      description,
      ...overrides,
    },
  });
}

async function clearDocs(): Promise<void> {
  const allDocs = await payload.find<Post>({ collection: slug, limit: 100 });
  const ids = allDocs.docs.map((doc) => doc.id);
  await mapAsync(ids, async (id) => {
    await payload.delete({ collection: slug, id });
  });
}

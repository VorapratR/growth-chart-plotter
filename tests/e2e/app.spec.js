const { test, expect } = require('@playwright/test');

/* Every test gets a fresh browser context, so localStorage + IndexedDB start
   empty. Fail loudly on any uncaught page error or console error. */
test.beforeEach(async ({ page }) => {
  page.on('pageerror', err => { throw err; });
  page.on('console', msg => {
    if (msg.type() === 'error') throw new Error('console.error: ' + msg.text());
  });
});

/* initApp() is async (opens IndexedDB, loads a patient) and sets
   <html data-ready> when done. Wait on that before touching the UI. */
async function open(page) {
  await page.goto('/');
  await page.waitForSelector('html[data-ready]');
}
async function reload(page) {
  await page.reload();
  await page.waitForSelector('html[data-ready]');
}
const row = (page, name) => page.locator('#ptList .pt', { hasText: name });

test('loads, plots the demo, and fills the results table', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'ใส่ข้อมูลตัวอย่าง' }).click();
  await expect(page.locator('#svg path').first()).toBeVisible();
  expect(await page.locator('#svg path').count()).toBeGreaterThan(5);
  await expect(page.locator('#results table.out tbody tr')).toHaveCount(4);
});

test('shows a growth-velocity column with a numeric rate for age modes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'ใส่ข้อมูลตัวอย่าง' }).click();   // demo = height/weight-for-age
  await expect(page.locator('#results thead th', { hasText: 'ซม./ปี' })).toBeVisible();
  const vel2 = page.locator('#results tbody tr').nth(1).locator('td.vel').first();
  await expect(vel2).toHaveText(/^[+-]\d/);                                // row 2: signed number
  await expect(page.locator('#results tbody tr').nth(0).locator('td.vel').first()).toHaveText('—');
});

test('weight-for-height mode has no velocity column (no time axis)', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'นน. ตามส่วนสูง' }).click();
  await page.getByRole('button', { name: 'ใส่ข้อมูลตัวอย่าง' }).click();
  await expect(page.locator('#results table.out')).toBeVisible();
  await expect(page.locator('#results thead th', { hasText: '/ปี' })).toHaveCount(0);
});

test('persists across reload (IndexedDB + prefs)', async ({ page }) => {
  await open(page);
  await page.fill('#hn', 'RELOAD-TEST');
  await page.fill('#dob', '2018-04-01');
  await page.getByRole('button', { name: 'BMI ตามอายุ' }).click();

  await reload(page);
  await expect(page.locator('#hn')).toHaveValue('RELOAD-TEST');
  await expect(page.locator('#dob')).toHaveValue('2018-04-01');
  await expect(page.locator('#modeSeg button[aria-pressed="true"]')).toHaveAttribute('data-mode', 'bmi');
});

test('manages multiple patients: add, switch, search, soft-delete, restore', async ({ page }) => {
  await open(page);
  await page.fill('#hn', 'Patient One');

  await page.getByRole('button', { name: '+ เพิ่มคนไข้' }).click();
  await page.fill('#hn', 'Patient Two');
  await expect(page.locator('#ptList .pt')).toHaveCount(2);
  await expect(row(page, 'Patient One')).toBeVisible();

  await row(page, 'Patient One').locator('.pt-main').click();
  await expect(page.locator('#hn')).toHaveValue('Patient One');

  await page.fill('#ptSearch', 'Two');
  await expect(page.locator('#ptList .pt')).toHaveCount(1);
  await page.fill('#ptSearch', '');

  page.once('dialog', d => d.accept());
  await row(page, 'Patient Two').getByRole('button').click();
  await expect(page.locator('#ptList .pt')).toHaveCount(1);

  await page.getByRole('button', { name: /ที่ลบแล้ว \(1\)/ }).click();
  await expect(row(page, 'Patient Two')).toBeVisible();
  await row(page, 'Patient Two').getByRole('button').click();
  await expect(page.getByRole('button', { name: /ที่ลบแล้ว/ })).toBeHidden();
  await expect(page.locator('#ptList .pt')).toHaveCount(2);
});

test('typing right after "+ เพิ่มคนไข้" does not clobber the previous patient', async ({ page }) => {
  await open(page);
  await page.fill('#hn', 'Keep Me');
  await page.getByRole('button', { name: '+ เพิ่มคนไข้' }).click();
  // the switch must be synchronous — S._pid updated before control returns:
  await expect(page.locator('#hn')).toHaveValue('');
  await expect(page.locator('#ptList .pt.cur b')).toHaveText('(ไม่ระบุชื่อ/HN)');
  await page.fill('#hn', 'New One');            // goes to the new patient, not "Keep Me"

  await row(page, 'Keep Me').locator('.pt-main').click();
  await expect(page.locator('#hn')).toHaveValue('Keep Me');   // the old bug wrote '' here
});

test('export -> import round-trips patient data', async ({ page }) => {
  await open(page);
  await page.fill('#hn', 'RT One');
  await page.fill('#dob', '2017-02-03');
  await page.getByRole('button', { name: '+ เพิ่มคนไข้' }).click();
  await page.fill('#hn', 'RT Two');
  await expect(row(page, 'RT One')).toBeVisible();

  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  const p = await dl.path();

  const onDialog = d => d.accept();               // import fires a confirm then an alert
  page.on('dialog', onDialog);
  await page.setInputFiles('#filePatients', p);

  // the two imported copies are added alongside the originals
  await expect(row(page, 'RT One')).toHaveCount(2);
  await expect(row(page, 'RT Two')).toHaveCount(2);
  page.off('dialog', onDialog);
  await row(page, 'RT One').first().locator('.pt-main').click();
  await expect(page.locator('#dob')).toHaveValue('2017-02-03');
});

test('Export PDF produces a file without error', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'ใส่ข้อมูลตัวอย่าง' }).click();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export PDF' }).click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/\.pdf$/);
  const stream = await dl.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const buf = Buffer.concat(chunks);
  expect(buf.length).toBeGreaterThan(1000);
  expect(buf.slice(0, 5).toString()).toBe('%PDF-');
});

test('"ล้างข้อมูลทั้งหมด" wipes storage back to one blank patient', async ({ page }) => {
  await open(page);
  await page.fill('#hn', 'Doomed');
  await page.getByRole('button', { name: '+ เพิ่มคนไข้' }).click();
  await expect(page.locator('#ptList .pt')).toHaveCount(2);

  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'ล้างข้อมูลทั้งหมด' }).click();

  await expect(page.locator('#ptList .pt')).toHaveCount(1);
  await expect(page.locator('#hn')).toHaveValue('');
  await expect(page.locator('#results .empty')).toBeVisible();
});

test('migrates a phase-1 localStorage blob into a patient row on first load', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('growthchart:state:v1', JSON.stringify({
      mode: 'bmi', sex: 'M', chartStyle: 'stacked', ref: 'tspe2565',
      hn: 'LEGACY BLOB', dob: '2020-03-10', fh: null, mh: null,
      visits: [{ date: '2023-03-10', ht: '95', wt: '17.5', hc: '' }],
    }));
  });
  await open(page);
  await expect(page.locator('#hn')).toHaveValue('LEGACY BLOB');
  await expect(row(page, 'LEGACY BLOB')).toBeVisible();
  await expect(page.locator('#modeSeg button[aria-pressed="true"]')).toHaveAttribute('data-mode', 'bmi');
});

test('every chart mode renders without error', async ({ page }) => {
  await open(page);
  for (const name of ['สูง/นน. ตามอายุ', 'BMI ตามอายุ', 'รอบศีรษะ', 'นน. ตามส่วนสูง']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'ใส่ข้อมูลตัวอย่าง' }).click();
    await expect(page.locator('#svg path').first()).toBeVisible();
  }
});

test('exports a growthchart/v2 JSON bundle of all patients', async ({ page }) => {
  await open(page);
  await page.fill('#hn', 'Export A');
  await page.getByRole('button', { name: '+ เพิ่มคนไข้' }).click();
  await page.fill('#hn', 'Export B');
  await expect(row(page, 'Export A')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export JSON' }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  const bundle = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  expect(bundle.schema).toBe('growthchart/v2');
  expect(bundle.patients.map(p => p.hn).sort()).toEqual(['Export A', 'Export B']);
});

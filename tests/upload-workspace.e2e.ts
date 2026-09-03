import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import * as XLSX from 'xlsx';

const storedCredential = {
	envelope: 'old-encrypted-envelope',
	mallId: 'woodabang',
	shopNo: '1',
	userId: 'woodabang',
	accessTokenExpiresAt: '2000-08-28T18:00:00.000Z',
	refreshTokenExpiresAt: '2099-09-12T04:35:00.000Z',
	scopes: [
		'mall.read_product',
		'mall.write_product',
		'mall.read_application',
		'mall.write_application'
	],
	savedAt: '2026-08-28T17:00:00.000Z'
};

const refreshedCredential = {
	...storedCredential,
	envelope: 'new-encrypted-envelope',
	accessTokenExpiresAt: '2099-08-29T04:35:00.000Z',
	savedAt: '2026-08-28T17:01:00.000Z'
};

function authPayload(
	credential: typeof storedCredential,
	envelope: typeof storedCredential | null = null
) {
	return {
		ok: true,
		auth: {
			mallId: credential.mallId,
			shopNo: credential.shopNo,
			userId: credential.userId,
			accessTokenExpiresAt: credential.accessTokenExpiresAt,
			refreshTokenExpiresAt: credential.refreshTokenExpiresAt,
			scopes: credential.scopes
		},
		credential: envelope
	};
}

test('연결 정보는 안전한 메타데이터만 표시하고 결과를 조회·다운로드한다', async ({
	page
}, testInfo) => {
	const refreshRequests: string[] = [];
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.evaluate(async (credential) => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('cafe24-additional-products', 2);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains('credential')) db.createObjectStore('credential');
				if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
			};
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction('credential', 'readwrite');
			transaction.objectStore('credential').put(credential, 'active');
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	}, storedCredential);

	await page.route('**/api/auth/status', (route) =>
		route.fulfill({ json: authPayload(storedCredential) })
	);
	await page.route('**/api/auth/refresh', (route) => {
		refreshRequests.push(route.request().postData() ?? '');
		return route.fulfill({ json: authPayload(refreshedCredential, refreshedCredential) });
	});
	const productCodeRequests: string[] = [];
	const productNumbersByCode: Record<string, number> = {
		P0000DGB: 2175,
		P0000DGC: 2176,
		P0000DGD: 2178,
		P0000DGE: 2179,
		P0000DGF: 2180
	};
	await page.route('**/api/product-codes', (route) => {
		const postData = route.request().postData() ?? '';
		productCodeRequests.push(postData);
		const { productCodes } = JSON.parse(postData) as { productCodes: string[] };
		return route.fulfill({
			json: {
				ok: true,
				resolutions: productCodes.map((productCode) => ({
					productCode,
					productNo: productNumbersByCode[productCode] ?? null,
					message:
						productNumbersByCode[productCode] === undefined
							? 'Cafe24에서 해당 상품코드를 찾지 못했습니다.'
							: null
				})),
				credential: null
			}
		});
	});
	let additionalProductCalls = 0;
	const operationResults = [
		{
			ok: false,
			status: 429,
			method: null,
			productNo: 2175,
			additionalProducts: [2176, 2178, 2179, 2180],
			totalCount: null,
			message: 'Cafe24 API 호출 한도에 도달했습니다.',
			rateLimit: { callUsage: '100', callRemain: '0', timeUsage: '100', timeRemain: '0' }
		},
		{
			ok: true,
			status: 200,
			method: 'POST',
			productNo: 2175,
			additionalProducts: [2176, 2178, 2179, 2180],
			totalCount: 4,
			message: '등록했습니다.'
		},
		{
			ok: false,
			status: 422,
			method: 'PUT',
			productNo: 3001,
			additionalProducts: [3002],
			totalCount: null,
			message: 'Cafe24 추가구성상품을 찾을 수 없습니다.'
		}
	];
	await page.route('**/api/additional-products', (route) => {
		additionalProductCalls += 1;
		const result = operationResults.shift();
		if (!result) return route.abort();
		return route.fulfill({
			json: {
				ok: true,
				result: {
					...result,
					rateLimit: result.rateLimit ?? {
						callUsage: null,
						callRemain: null,
						timeUsage: null,
						timeRemain: null
					}
				},
				credential: null
			}
		});
	});

	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: '추가구성상품 엑셀 업로드' })).toBeVisible();
	await expect(page.getByText('몰 아이디: woodabang', { exact: false })).toBeVisible();
	await expect.poll(() => refreshRequests.length).toBe(1);
	await expect(page.locator('.auth-pill')).toContainText('2099');
	await expect(page.getByText('암호화된 연결 정보를 불러왔습니다.')).toHaveCount(0);
	await expect(page.getByText('지원 형식: UTF-8', { exact: false })).toHaveCount(0);
	await expect(page.getByText('적용 대상: Products additionalproducts POST / PUT')).toHaveCount(0);
	await expect(page.getByRole('button', { name: '연결 해제' })).toHaveCount(0);
	await expect(page.locator('body')).not.toContainText('old-encrypted-envelope');
	await expect(page.locator('body')).not.toContainText('new-encrypted-envelope');
	await expect(page.getByRole('button', { name: '파일 선택 후 Cafe24에 적용' })).toBeDisabled();
	await page.getByRole('button', { name: '사용 방법 열기' }).click();
	const usageGuide = page.getByRole('region', { name: '업로드 사용 방법' });
	await expect(usageGuide).toContainText('한 번에 최대 500행');
	await expect(usageGuide).toContainText('상품번호');
	await expect(usageGuide).toContainText('상품코드');
	await page.screenshot({ path: testInfo.outputPath('upload-usage-guide.png'), fullPage: true });
	await page.getByRole('button', { name: '사용 방법 닫기' }).click();
	const templateDownloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: '추가구성상품 설정용 XLSX 양식 다운로드' }).click();
	const templateDownload = await templateDownloadPromise;
	expect(templateDownload.suggestedFilename()).toBe('cafe24-additional-products-template.xlsx');
	const templatePath = await templateDownload.path();
	expect(templatePath).not.toBeNull();
	const templateWorkbook = XLSX.read(await readFile(templatePath!), { type: 'buffer' });
	expect(templateWorkbook.SheetNames).toEqual(['추가구성상품']);
	expect(
		XLSX.utils.sheet_to_json(templateWorkbook.Sheets['추가구성상품'], { header: 1 })[0]
	).toEqual([
		'기준상품번호',
		...Array.from({ length: 10 }, (_, index) => `추가구성상품번호${index + 1}`)
	]);

	await page.locator('input[type="file"]').setInputFiles({
		name: 'legacy-template.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'\uFEFF처리방식,기준상품번호,추가구성상품번호1,추가구성상품번호2,추가구성상품번호3,추가구성상품번호4,추가구성상품번호5,추가구성상품번호6,추가구성상품번호7,추가구성상품번호8,추가구성상품번호9,추가구성상품번호10\r\n,P0000DGB,P0000DGC,P0000DGD,P0000DGE,P0000DGF,,,,,,\r\n,3001,3002'
		)
	});
	await expect(
		page.getByText(
			'2개 행을 확인했습니다. 적용 전에 상품코드를 상품번호로 확인하고, 현재 추가구성상품 설정에 따라 등록 또는 수정을 자동 선택합니다.'
		)
	).toBeVisible();
	const uploadWorkbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(
		uploadWorkbook,
		XLSX.utils.aoa_to_sheet([
			['기준상품번호', ...Array.from({ length: 10 }, (_, index) => `추가구성상품번호${index + 1}`)],
			[2175, 2176]
		]),
		'추가구성상품'
	);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'additional-products.xlsx',
		mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		buffer: Buffer.from(XLSX.write(uploadWorkbook, { bookType: 'xlsx', type: 'buffer' }))
	});
	await expect(page.getByText('선택 파일: additional-products.xlsx')).toBeVisible();
	await expect(
		page.getByText(
			'1개 행을 확인했습니다. 적용 전에 상품코드를 상품번호로 확인하고, 현재 추가구성상품 설정에 따라 등록 또는 수정을 자동 선택합니다.'
		)
	).toBeVisible();
	await page.locator('input[type="file"]').setInputFiles({
		name: 'legacy-template.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'\uFEFF처리방식,기준상품번호,추가구성상품번호1,추가구성상품번호2,추가구성상품번호3,추가구성상품번호4,추가구성상품번호5,추가구성상품번호6,추가구성상품번호7,추가구성상품번호8,추가구성상품번호9,추가구성상품번호10\r\n,P0000DGB,P0000DGC,P0000DGD,P0000DGE,P0000DGF,,,,,,\r\n,3001,3002'
		)
	});
	await expect(
		page.getByText('처리방식은 등록/POST 또는 수정/PUT만 입력할 수 있습니다.')
	).toHaveCount(0);
	const applyButton = page.getByRole('button', { name: 'Cafe24에 적용하기' });
	await expect(applyButton).toBeEnabled();
	await applyButton.click();
	await expect(page.getByText('반영을 마쳤지만 1개 행이 실패했습니다.')).toBeVisible();
	expect(additionalProductCalls).toBe(3);
	expect(productCodeRequests).toHaveLength(1);
	expect(JSON.parse(productCodeRequests[0]).productCodes).toEqual([
		'P0000DGB',
		'P0000DGC',
		'P0000DGD',
		'P0000DGE',
		'P0000DGF'
	]);
	await expect(page.getByRole('button', { name: '실패 결과 확인 필요' })).toBeDisabled();
	await expect(
		page.getByText('실패한 행의 결과를 확인하고 파일 또는 상품 상태를 수정한 뒤 다시 적용하세요.')
	).toBeVisible();
	await page.getByRole('button', { name: '결과 보기' }).click();
	const resultTable = page.locator('.result-table');
	await expect(resultTable).toContainText('2175');
	await expect(resultTable).toContainText('2176, 2178, 2179, 2180');
	await expect(resultTable).toContainText('HTTP 200 · 총 4개');
	await expect(resultTable).toContainText('등록했습니다.');
	await expect(resultTable).toContainText('3001');
	await expect(resultTable).toContainText('HTTP 422');
	await expect(resultTable).toContainText('실패');
	await expect(resultTable).toContainText('Cafe24 추가구성상품을 찾을 수 없습니다.');

	const downloadPromise = page.waitForEvent('download');
	await page.getByRole('button', { name: '결과 CSV 다운로드' }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe('legacy-template-results.csv');
	const downloadPath = await download.path();
	expect(downloadPath).not.toBeNull();
	const downloadedCsv = await readFile(downloadPath!, 'utf8');
	expect(downloadedCsv).toContain('기준상품번호');
	expect(downloadedCsv).toContain('2176 | 2178 | 2179 | 2180');
	expect(downloadedCsv).toContain('HTTP 상태');
	expect(downloadedCsv).toContain('Cafe24 추가구성상품을 찾을 수 없습니다.');

	const savedEnvelope = await page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('cafe24-additional-products', 2);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const envelope = await new Promise<string>((resolve, reject) => {
			const request = database
				.transaction('credential', 'readonly')
				.objectStore('credential')
				.get('active');
			request.onsuccess = () => resolve(request.result.envelope);
			request.onerror = () => reject(request.error);
		});
		database.close();
		return envelope;
	});
	expect(savedEnvelope).toBe('new-encrypted-envelope');
	await page.screenshot({ path: testInfo.outputPath('upload-workspace.png'), fullPage: true });
	await expect(
		page.getByRole('button', { name: 'legacy-template.csv 완료 기록 삭제' })
	).toBeVisible();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: '완료 기록 전체 삭제' }).click();
	await expect(page.getByText('완료 기록 1건을 모두 삭제했습니다.')).toBeVisible();
	await expect(page.getByText('완료된 파일이 없습니다.')).toBeVisible();
	await page.reload();
	await page.waitForLoadState('networkidle');
	await expect(page.getByText('완료된 파일이 없습니다.')).toBeVisible();
	await page.evaluate(async () => {
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('cafe24-additional-products', 2);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction('jobs', 'readwrite');
			const store = transaction.objectStore('jobs');
			for (let index = 0; index < 12; index += 1) {
				store.put({
					id: `history-${index}`,
					fileName: `completed-${index + 1}.csv`,
					startedAt: `2026-09-01T00:${String(index).padStart(2, '0')}:00.000Z`,
					completedAt: `2026-09-01T00:${String(index).padStart(2, '0')}:30.000Z`,
					successCount: 1,
					failureCount: 0,
					total: 1,
					status: 'completed',
					results: []
				});
			}
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
	});
	await page.reload();
	await page.waitForLoadState('networkidle');
	const completedList = page.locator('.finished-job-list');
	await expect(completedList.locator('.job-card')).toHaveCount(12);
	expect(
		await completedList.evaluate((element) => element.scrollHeight > element.clientHeight)
	).toBe(true);
	await page.screenshot({
		path: testInfo.outputPath('completed-history-scroll.png'),
		fullPage: true
	});
	const headers = [
		'기준상품번호',
		...Array.from({ length: 10 }, (_, index) => `추가구성상품번호${index + 1}`)
	];
	const tooManyRows = Array.from({ length: 501 }, (_, index) => `${index + 1},${index + 1001}`);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'over-500-rows.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(`${headers.join(',')}\n${tooManyRows.join('\n')}`)
	});
	await expect(
		page.getByText(
			'한 번에 최대 500행만 적용할 수 있습니다. 501행 이상인 파일은 나누어 다시 업로드해주세요.'
		)
	).toBeVisible();
	await expect(page.getByText('데이터 행은 최대 500개까지 처리할 수 있습니다.')).toBeVisible();
});

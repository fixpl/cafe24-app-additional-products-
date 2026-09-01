import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

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
	const operationResults = [
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
		const result = operationResults.shift();
		if (!result) return route.abort();
		return route.fulfill({
			json: {
				ok: true,
				result: {
					...result,
					rateLimit: {
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

	await page.locator('input[type="file"]').setInputFiles({
		name: 'legacy-template.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'\uFEFF처리방식,기준상품번호,추가구성상품번호1,추가구성상품번호2,추가구성상품번호3,추가구성상품번호4,추가구성상품번호5,추가구성상품번호6,추가구성상품번호7,추가구성상품번호8,추가구성상품번호9,추가구성상품번호10\r\n,2175,2176,2178,2179,2180,,,,,,\r\n,3001,3002'
		)
	});
	await expect(
		page.getByText(
			'2개 행을 확인했습니다. 업로드 시 현재 추가구성상품 설정을 조회해 등록 또는 수정을 자동 선택합니다.'
		)
	).toBeVisible();
	await expect(
		page.getByText('처리방식은 등록/POST 또는 수정/PUT만 입력할 수 있습니다.')
	).toHaveCount(0);
	const applyButton = page.getByRole('button', { name: 'Cafe24에 적용하기' });
	await expect(applyButton).toBeEnabled();
	await applyButton.click();
	await expect(page.getByText('반영을 마쳤지만 1개 행이 실패했습니다.')).toBeVisible();
	await expect(page.getByRole('button', { name: '실패 결과 확인 필요' })).toBeDisabled();
	await expect(
		page.getByText('실패한 행의 결과를 확인하고 CSV 또는 상품 상태를 수정한 뒤 다시 적용하세요.')
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
});

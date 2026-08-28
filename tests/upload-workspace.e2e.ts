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

test('연결 정보는 안전한 메타데이터만 표시하고 만료 전 자동으로 갱신한다', async ({
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
});

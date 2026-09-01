import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	decryptTokenEnvelope,
	encryptTokenPayload,
	hashSessionBinding,
	type TokenPayload
} from './crypto';
import { executeAdditionalProductOperation } from './additional-products';

const fixtures = vi.hoisted(() => {
	const refreshCafe24Token = vi.fn();
	const keyEntries = [{ kid: 'v1', key: Buffer.alloc(32, 13) }];
	return {
		refreshCafe24Token,
		keyEntries
	};
});

vi.mock('$lib/server/env', () => ({
	getCafe24ApiVersion: () => '2026-06-01',
	getRequestTimeoutMs: () => 5_000,
	getCafe24ClientId: () => 'client-id',
	getTokenEncryptionKeys: () => fixtures.keyEntries
}));

vi.mock('./oauth', () => ({
	refreshCafe24Token: fixtures.refreshCafe24Token
}));

function makePayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
	return {
		accessToken: 'access-token-123',
		refreshToken: 'refresh-token-123',
		accessTokenExpiresAt: '2026-08-27T23:59:59.000Z',
		refreshTokenExpiresAt: '2026-08-28T23:59:59.000Z',
		clientId: 'client-id',
		mallId: 'mall-1',
		shopNo: '1',
		userId: 'user-1',
		scopes: [
			'mall.read_product',
			'mall.write_product',
			'mall.read_application',
			'mall.write_application'
		],
		issuedAt: '2026-08-27T10:00:00.000Z',
		sessionBindingHash: hashSessionBinding('browser-session'),
		...overrides
	};
}

function makeEnvelope(payload: TokenPayload) {
	return encryptTokenPayload(payload);
}

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function additionalProductResponse(totalCount: number, productNo = 123) {
	return {
		additionalproduct: {
			product_no: productNo,
			additional_products: totalCount > 0 ? [1999] : [],
			total_count: totalCount
		}
	};
}

function assertCafe24Request(
	call: [RequestInfo | URL, RequestInit?],
	{
		method,
		productNo,
		token
	}: {
		method: 'GET' | 'POST' | 'PUT';
		productNo: number;
		token: string;
	}
) {
	const [input, init] = call;
	const url = new URL(String(input));
	const headers = new Headers(init?.headers);

	expect(url.origin).toBe('https://mall-1.cafe24api.com');
	expect(url.pathname).toBe(`/api/v2/admin/products/${productNo}/additionalproducts`);
	expect(init?.method).toBe(method);
	expect(headers.get('authorization')).toBe(`Bearer ${token}`);
	expect(headers.get('accept')).toBe('application/json');
	expect(headers.get('x-cafe24-api-version')).toBe('2026-06-01');
	if (method === 'GET') {
		expect(headers.get('content-type')).toBeNull();
		expect(init?.body).toBeUndefined();
	} else {
		expect(headers.get('content-type')).toBe('application/json');
		expect(init?.body).toBe(JSON.stringify({ request: { additional_products: [2001, 2002] } }));
	}
}

describe('executeAdditionalProductOperation', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-27T12:00:00.000Z'));
		fixtures.refreshCafe24Token.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it.each([
		{ currentCount: 0, expectedMethod: 'POST' as const },
		{ currentCount: 1, expectedMethod: 'PUT' as const }
	])(
		'현재 $currentCount건이면 $expectedMethod를 자동 선택한다',
		async ({ currentCount, expectedMethod }) => {
			const payload = makePayload();
			const envelope = makeEnvelope(payload);
			const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				return init?.method === 'GET'
					? response(additionalProductResponse(currentCount))
					: response(additionalProductResponse(2));
			});

			vi.stubGlobal('fetch', fetchMock);

			const result = await executeAdditionalProductOperation({
				envelope,
				sessionCookie: 'browser-session',
				operation: { row: 2, productNo: 123, additionalProducts: [2001, 2002] }
			});

			expect(fetchMock).toHaveBeenCalledTimes(2);
			assertCafe24Request(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?], {
				method: 'GET',
				productNo: 123,
				token: payload.accessToken
			});
			assertCafe24Request(fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit?], {
				method: expectedMethod,
				productNo: 123,
				token: payload.accessToken
			});
			expect(result.result).toEqual({
				ok: true,
				status: 200,
				method: expectedMethod,
				productNo: 123,
				additionalProducts: [1999],
				totalCount: 2,
				message: expectedMethod === 'POST' ? '등록했습니다.' : '수정했습니다.',
				rateLimit: { callUsage: null, callRemain: null, timeUsage: null, timeRemain: null }
			});
			expect(result.credential).toBeNull();
		}
	);

	it('조회 요청이 401이면 refresh 후 다시 조회하고 새 credential을 돌려준다', async () => {
		const payload = makePayload();
		const refreshed = makePayload({ accessToken: 'new-token' });
		const envelope = makeEnvelope(payload);
		fixtures.refreshCafe24Token.mockResolvedValue(refreshed);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response({ error: { code: 'expired' } }, 401))
			.mockResolvedValueOnce(response(additionalProductResponse(0)))
			.mockResolvedValueOnce(response(additionalProductResponse(2)));

		vi.stubGlobal('fetch', fetchMock);

		const result = await executeAdditionalProductOperation({
			envelope,
			sessionCookie: 'browser-session',
			operation: { row: 2, productNo: 123, additionalProducts: [2001, 2002] }
		});

		expect(fixtures.refreshCafe24Token).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		assertCafe24Request(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?], {
			method: 'GET',
			productNo: 123,
			token: payload.accessToken
		});
		assertCafe24Request(fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit?], {
			method: 'GET',
			productNo: 123,
			token: refreshed.accessToken
		});
		assertCafe24Request(fetchMock.mock.calls[2] as [RequestInfo | URL, RequestInit?], {
			method: 'POST',
			productNo: 123,
			token: refreshed.accessToken
		});
		expect(result.result.ok).toBe(true);
		expect(result.credential).not.toBeNull();
		expect(decryptTokenEnvelope(result.credential!.envelope).payload.accessToken).toBe(
			refreshed.accessToken
		);
	});

	it('조회 실패 시 POST나 PUT을 보내지 않는다', async () => {
		const payload = makePayload();
		const envelope = makeEnvelope(payload);
		const fetchMock = vi.fn().mockResolvedValue(response({ error: { code: 'not_found' } }, 404));

		vi.stubGlobal('fetch', fetchMock);

		const result = await executeAdditionalProductOperation({
			envelope,
			sessionCookie: 'browser-session',
			operation: { row: 2, productNo: 123, additionalProducts: [2001, 2002] }
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		assertCafe24Request(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?], {
			method: 'GET',
			productNo: 123,
			token: payload.accessToken
		});
		expect(result.result).toMatchObject({ ok: false, status: 404, method: null, productNo: 123 });
	});

	it('refresh 후에도 조회가 401이면 재로그인을 요구한다', async () => {
		const payload = makePayload();
		const refreshed = makePayload({ accessToken: 'new-token' });
		const envelope = makeEnvelope(payload);
		fixtures.refreshCafe24Token.mockResolvedValue(refreshed);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response({ error: { code: 'expired' } }, 401))
			.mockResolvedValueOnce(response({ error: { code: 'still-expired' } }, 401));

		vi.stubGlobal('fetch', fetchMock);

		await expect(
			executeAdditionalProductOperation({
				envelope,
				sessionCookie: 'browser-session',
				operation: { row: 2, productNo: 123, additionalProducts: [2001, 2002] }
			})
		).rejects.toMatchObject({
			status: 401,
			code: 'CAFE24_REAUTHORIZE',
			reauthorize: true
		});

		expect(fixtures.refreshCafe24Token).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

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

function assertCafe24Request(
	call: [RequestInfo | URL, RequestInit?],
	{
		method,
		productNo,
		token
	}: {
		method: 'POST' | 'PUT';
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
	expect(headers.get('content-type')).toBe('application/json');
	expect(headers.get('x-cafe24-api-version')).toBe('2026-06-01');
	expect(init?.body).toBe(JSON.stringify({ request: { additional_products: [2001, 2002] } }));
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

	it.each(['POST', 'PUT'] as const)('exact %s 요청을 보낸다', async (method) => {
		const payload = makePayload();
		const envelope = makeEnvelope(payload);
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			assertCafe24Request([input, init], { method, productNo: 123, token: payload.accessToken });
			return response({
				additionalproduct: {
					product_no: 123,
					additional_products: [2001, 2002],
					total_count: 2
				}
			});
		});

		vi.stubGlobal('fetch', fetchMock);

		const result = await executeAdditionalProductOperation({
			envelope,
			sessionCookie: 'browser-session',
			operation: { row: 2, method, productNo: 123, additionalProducts: [2001, 2002] }
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.result).toEqual({
			ok: true,
			status: 200,
			productNo: 123,
			additionalProducts: [2001, 2002],
			totalCount: 2,
			message: method === 'POST' ? '등록했습니다.' : '수정했습니다.',
			rateLimit: { callUsage: null, callRemain: null, timeUsage: null, timeRemain: null }
		});
		expect(result.credential).toBeNull();
	});

	it('401을 한 번 받으면 refresh 후 재시도하고 새 credential을 돌려준다', async () => {
		const payload = makePayload();
		const refreshed = makePayload({ accessToken: 'new-token' });
		const envelope = makeEnvelope(payload);
		fixtures.refreshCafe24Token.mockResolvedValue(refreshed);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response({ error: { code: 'expired' } }, 401))
			.mockResolvedValueOnce(
				response({
					additionalproduct: {
						product_no: 123,
						additional_products: [2001, 2002],
						total_count: 2
					}
				})
			);

		vi.stubGlobal('fetch', fetchMock);

		const result = await executeAdditionalProductOperation({
			envelope,
			sessionCookie: 'browser-session',
			operation: { row: 2, method: 'POST', productNo: 123, additionalProducts: [2001, 2002] }
		});

		expect(fixtures.refreshCafe24Token).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		assertCafe24Request(fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit?], {
			method: 'POST',
			productNo: 123,
			token: payload.accessToken
		});
		assertCafe24Request(fetchMock.mock.calls[1] as [RequestInfo | URL, RequestInit?], {
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

	it('refresh 후에도 401이 반복되면 재로그인을 요구한다', async () => {
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
				operation: { row: 2, method: 'POST', productNo: 123, additionalProducts: [2001, 2002] }
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

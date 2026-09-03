import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptTokenPayload, hashSessionBinding, type TokenPayload } from './crypto';
import { resolveCafe24ProductCodes } from './products';

const fixtures = vi.hoisted(() => ({
	refreshCafe24Token: vi.fn(),
	keyEntries: [{ kid: 'v1', key: Buffer.alloc(32, 29) }]
}));

vi.mock('$lib/server/env', () => ({
	getCafe24ApiVersion: () => '2026-06-01',
	getRequestTimeoutMs: () => 5_000,
	getCafe24ClientId: () => 'client-id',
	getTokenEncryptionKeys: () => fixtures.keyEntries
}));

vi.mock('./oauth', () => ({ refreshCafe24Token: fixtures.refreshCafe24Token }));

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

function response(body: unknown, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('resolveCafe24ProductCodes', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-27T12:00:00.000Z'));
		fixtures.refreshCafe24Token.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('입력된 상품코드만 목록 조회로 찾아 정확히 상품번호로 변환한다', async () => {
		const payload = makePayload();
		const fetchMock = vi.fn().mockResolvedValue(
			response({
				products: [
					{ product_no: 2185, product_code: 'P0000DGB' },
					{ product_no: 2182, product_code: 'P0000DFY' },
					{ product_no: 9999, product_code: 'P0000DGB-ARCHIVE' }
				]
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await resolveCafe24ProductCodes({
			envelope: encryptTokenPayload(payload),
			sessionCookie: 'browser-session',
			productCodes: ['P0000DGB', 'P0000DFY', 'P0000MISS']
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [request, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
		const url = new URL(String(request));
		expect(url.origin).toBe('https://mall-1.cafe24api.com');
		expect(url.pathname).toBe('/api/v2/admin/products');
		expect(url.searchParams.get('shop_no')).toBe('1');
		expect(url.searchParams.get('product_code')).toBe('P0000DGB,P0000DFY,P0000MISS');
		expect(url.searchParams.get('fields')).toBe('product_no,product_code');
		expect(url.searchParams.get('limit')).toBe('100');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer access-token-123');
		expect(result).toEqual({
			resolutions: [
				{ productCode: 'P0000DGB', productNo: 2185, message: null },
				{ productCode: 'P0000DFY', productNo: 2182, message: null },
				{
					productCode: 'P0000MISS',
					productNo: null,
					message: 'Cafe24에서 해당 상품코드를 찾지 못했습니다.'
				}
			],
			credential: null
		});
	});

	it('상품 목록 조회가 401이면 refresh한 토큰으로 한 번만 재시도한다', async () => {
		const payload = makePayload();
		const refreshed = makePayload({ accessToken: 'new-token' });
		fixtures.refreshCafe24Token.mockResolvedValue(refreshed);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(response({ error: { code: 'expired' } }, 401))
			.mockResolvedValueOnce(
				response({ products: [{ product_no: 2185, product_code: 'P0000DGB' }] })
			);
		vi.stubGlobal('fetch', fetchMock);

		const result = await resolveCafe24ProductCodes({
			envelope: encryptTokenPayload(payload),
			sessionCookie: 'browser-session',
			productCodes: ['P0000DGB']
		});

		expect(fixtures.refreshCafe24Token).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(
			new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers).get('authorization')
		).toBe('Bearer new-token');
		expect(result.resolutions[0]).toEqual({
			productCode: 'P0000DGB',
			productNo: 2185,
			message: null
		});
		expect(result.credential).not.toBeNull();
	});
});

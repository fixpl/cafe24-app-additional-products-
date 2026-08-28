import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	decryptTokenEnvelope,
	encryptTokenPayload,
	hashSessionBinding,
	type TokenPayload
} from '$lib/server/cafe24/crypto';
import { POST } from './+server';

const fixtures = vi.hoisted(() => ({
	refreshCafe24Token: vi.fn(),
	keyEntries: [{ kid: 'v1', key: Buffer.alloc(32, 21) }]
}));

vi.mock('$lib/server/env', () => ({
	SESSION_BINDING_COOKIE: 'cafe24_ap_session',
	secureCookie: () => false,
	getCafe24ClientId: () => 'client-id',
	getTokenEncryptionKeys: () => fixtures.keyEntries
}));

vi.mock('$lib/server/cafe24/oauth', () => ({
	refreshCafe24Token: fixtures.refreshCafe24Token
}));

function makePayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
	return {
		accessToken: 'access-token-123',
		refreshToken: 'refresh-token-123',
		accessTokenExpiresAt: '2026-08-27T12:02:00.000Z',
		refreshTokenExpiresAt: '2026-09-10T12:00:00.000Z',
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

function createEvent(
	envelope: string,
	cookies: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> }
) {
	return {
		request: new Request('http://app.example.com/api/auth/refresh', {
			method: 'POST',
			headers: {
				origin: 'http://app.example.com',
				'content-type': 'application/json',
				'sec-fetch-site': 'same-origin'
			},
			body: JSON.stringify({ envelope })
		}),
		url: new URL('http://app.example.com/api/auth/refresh'),
		cookies
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/auth/refresh', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-27T12:00:00.000Z'));
		fixtures.refreshCafe24Token.mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('만료 5분 전에는 서버에서 refresh하고 새 암호문과 갱신된 만료 시각만 반환한다', async () => {
		const payload = makePayload();
		const refreshed = makePayload({
			accessToken: 'refreshed-access-token',
			refreshToken: 'refreshed-refresh-token',
			accessTokenExpiresAt: '2026-08-27T13:00:00.000Z',
			refreshTokenExpiresAt: '2026-09-11T12:00:00.000Z'
		});
		fixtures.refreshCafe24Token.mockResolvedValue(refreshed);
		const cookies = {
			get: vi.fn(() => 'browser-session'),
			set: vi.fn()
		};

		const response = await POST(createEvent(encryptTokenPayload(payload), cookies));
		const body = (await response.json()) as {
			ok: boolean;
			auth: { accessTokenExpiresAt: string };
			credential: { envelope: string };
		};

		expect(response.status).toBe(200);
		expect(fixtures.refreshCafe24Token).toHaveBeenCalledWith(payload);
		expect(body.ok).toBe(true);
		expect(body.auth.accessTokenExpiresAt).toBe(refreshed.accessTokenExpiresAt);
		expect(body.credential.envelope).not.toContain('refreshed-access-token');
		expect(decryptTokenEnvelope(body.credential.envelope).payload.accessToken).toBe(
			refreshed.accessToken
		);
		expect(cookies.set).toHaveBeenCalledWith(
			'cafe24_ap_session',
			'browser-session',
			expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'strict' })
		);
	});

	it('만료가 충분히 남은 credential은 Cafe24 refresh를 호출하지 않는다', async () => {
		const payload = makePayload({ accessTokenExpiresAt: '2026-08-27T13:00:00.000Z' });
		const cookies = {
			get: vi.fn(() => 'browser-session'),
			set: vi.fn()
		};

		const response = await POST(createEvent(encryptTokenPayload(payload), cookies));
		const body = (await response.json()) as {
			ok: boolean;
			auth: { accessTokenExpiresAt: string };
			credential: null;
		};

		expect(response.status).toBe(200);
		expect(fixtures.refreshCafe24Token).not.toHaveBeenCalled();
		expect(body).toEqual({
			ok: true,
			auth: expect.objectContaining({ accessTokenExpiresAt: payload.accessTokenExpiresAt }),
			credential: null
		});
		expect(cookies.set).not.toHaveBeenCalled();
	});
});

import { describe, expect, it } from 'vitest';
import { PublicError } from '$lib/server/http';
import {
	assertSessionBinding,
	assertStateCookie,
	decryptTokenEnvelope,
	encryptTokenPayload,
	hashSessionBinding,
	signOAuthState,
	stateCookieValue,
	verifyOAuthState,
	type TokenPayload
} from './crypto';

const keys = [
	{ kid: 'v2', key: Buffer.alloc(32, 1) },
	{ kid: 'v1', key: Buffer.alloc(32, 2) }
] as const;

function makePayload(overrides: Partial<TokenPayload> = {}): TokenPayload {
	return {
		accessToken: 'access-token',
		refreshToken: 'refresh-token',
		accessTokenExpiresAt: '2026-08-27T13:00:00.000Z',
		refreshTokenExpiresAt: '2026-09-10T13:00:00.000Z',
		clientId: 'client-id',
		mallId: 'samplemall',
		shopNo: '1',
		userId: 'user-1',
		scopes: [
			'mall.read_product',
			'mall.write_product',
			'mall.read_application',
			'mall.write_application'
		],
		issuedAt: '2026-08-27T12:00:00.000Z',
		sessionBindingHash: hashSessionBinding('session-cookie'),
		...overrides
	};
}

describe('token envelope', () => {
	it('암호화한 envelope를 같은 client와 key로 복호화한다', () => {
		const payload = makePayload();
		const envelope = encryptTokenPayload(payload, { keys: [...keys], clientId: 'client-id' });
		const decrypted = decryptTokenEnvelope(envelope, { keys: [...keys], clientId: 'client-id' });

		expect(decrypted.payload).toEqual(payload);
		expect(decrypted.needsKeyRotation).toBe(false);
	});

	it('이전 key로 암호화된 envelope는 rotation 필요 상태로 읽힌다', () => {
		const payload = makePayload();
		const envelope = encryptTokenPayload(payload, {
			keys: [keys[1]],
			clientId: 'client-id'
		});
		const decrypted = decryptTokenEnvelope(envelope, { keys: [...keys], clientId: 'client-id' });

		expect(decrypted.payload.mallId).toBe('samplemall');
		expect(decrypted.needsKeyRotation).toBe(true);
	});

	it('client id가 다르면 복호화를 거절한다', () => {
		const envelope = encryptTokenPayload(makePayload(), { keys: [...keys], clientId: 'client-id' });

		expect(() =>
			decryptTokenEnvelope(envelope, { keys: [...keys], clientId: 'another-client' })
		).toThrow(PublicError);
	});

	it('session binding이 다르면 사용을 거절한다', () => {
		expect(() => assertSessionBinding(makePayload(), 'different-cookie')).toThrow(PublicError);
	});

	it('이전 상품 scope만 가진 payload는 거절한다', () => {
		expect(() =>
			encryptTokenPayload(makePayload({ scopes: ['mall.read_product', 'mall.write_product'] }), {
				keys: [...keys],
				clientId: 'client-id'
			})
		).toThrow(PublicError);
	});
});

describe('oauth state', () => {
	it('서명한 state와 state cookie를 검증한다', () => {
		const state = signOAuthState(
			{
				v: 1,
				mallId: 'samplemall',
				shopNo: '1',
				userId: 'user-1',
				mode: 'launch',
				nonce: '123e4567-e89b-12d3-a456-426614174000',
				issuedAt: Date.parse('2026-08-27T12:00:00.000Z'),
				expiresAt: Date.parse('2026-08-27T12:10:00.000Z')
			},
			'state-secret'
		);

		expect(
			verifyOAuthState(state, Date.parse('2026-08-27T12:05:00.000Z'), 'state-secret')
		).toMatchObject({
			mallId: 'samplemall',
			mode: 'launch'
		});
		expect(() => assertStateCookie(state, stateCookieValue(state))).not.toThrow();
	});

	it('만료된 state를 거절한다', () => {
		const state = signOAuthState(
			{
				v: 1,
				mallId: 'samplemall',
				shopNo: '1',
				userId: null,
				mode: 'launch',
				nonce: '123e4567-e89b-12d3-a456-426614174111',
				issuedAt: Date.parse('2026-08-27T12:00:00.000Z'),
				expiresAt: Date.parse('2026-08-27T12:10:00.000Z')
			},
			'state-secret'
		);

		expect(() =>
			verifyOAuthState(state, Date.parse('2026-08-27T12:11:00.000Z'), 'state-secret')
		).toThrow(PublicError);
	});
});

import { describe, expect, it, vi } from 'vitest';
import { CAFE24_REQUIRED_SCOPES } from '$lib/shared/types';
import { beginCafe24OAuth } from './oauth';

vi.mock('$lib/server/env', () => ({
	getCafe24ClientId: () => 'client-id',
	getCafe24ClientSecret: () => 'client-secret',
	getCafe24RedirectUri: () => 'https://app.example.com/auth/callback',
	getOauthStateSecret: () => 'state-secret',
	getRequestTimeoutMs: () => 5_000,
	getTokenEncryptionKeys: () => [{ kid: 'v1', key: Buffer.alloc(32, 1) }]
}));

describe('beginCafe24OAuth', () => {
	it('Cafe24 인증 요청에 설정된 필수 scope 4개를 모두 포함한다', () => {
		const { authorizeUrl } = beginCafe24OAuth({
			mallId: 'samplemall',
			shopNo: '1',
			userId: 'admin',
			requestUrl: new URL('https://app.example.com/app')
		});
		const url = new URL(authorizeUrl);

		expect(url.searchParams.get('scope')).toBe(CAFE24_REQUIRED_SCOPES.join(' '));
		expect(url.searchParams.get('scope')?.split(' ')).toEqual([
			'mall.read_product',
			'mall.write_product',
			'mall.read_application',
			'mall.write_application'
		]);
	});
});

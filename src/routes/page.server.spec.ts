import { describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';

describe('root Cafe24 launch forwarding', () => {
	it('forwards a Cafe24 launch query to the signed /app handler without changing it', () => {
		const rawQuery =
			'is_multi_shop=T&lang=ko_KR&mall_id=woodabang&nation=KR&shop_no=1&timestamp=1787903389&user_id=woodabang&user_name=%EB%8C%80%ED%91%9C%20%EA%B4%80%EB%A6%AC%EC%9E%90&user_type=P&hmac=signature%3D';
		const url = new URL(`https://app.example.com/?${rawQuery}`);
		const setHeaders = vi.fn();

		try {
			load({ url, setHeaders } as unknown as Parameters<typeof load>[0]);
			expect.unreachable('Cafe24 launch requests must be redirected to /app');
		} catch (error) {
			expect(error).toMatchObject({
				status: 307,
				location: `/app?${rawQuery}`
			});
		}

		expect(setHeaders).toHaveBeenCalledWith({
			'cache-control': 'no-store, no-cache, must-revalidate, private'
		});
	});

	it('keeps a direct root request on the invalid-access screen', () => {
		const setHeaders = vi.fn();
		const result = load({
			url: new URL('https://app.example.com/'),
			setHeaders
		} as unknown as Parameters<typeof load>[0]);

		expect(result).toEqual({ invalidAccess: false });
	});
});

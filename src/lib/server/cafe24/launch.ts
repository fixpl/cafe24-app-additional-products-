import { createHmac, timingSafeEqual } from 'node:crypto';
import { canSkipLaunchHmac, getCafe24ClientSecret } from '$lib/server/env';
import { PublicError } from '$lib/server/http';
import { normalizeMallId, normalizeShopNo } from '$lib/shared/validation';

const SIGNED_KEYS = [
	'auth_config',
	'is_multi_shop',
	'lang',
	'mall_id',
	'nation',
	'shop_no',
	'timestamp',
	'user_id',
	'user_name',
	'user_type'
] as const;

export interface Cafe24LaunchContext {
	mallId: string;
	shopNo: string;
	userId: string | null;
	rawQuery: string;
	hmac: string;
	timestamp: string;
}

export function readAndValidateLaunch(url: URL): Cafe24LaunchContext {
	for (const key of ['mall_id', 'shop_no', 'timestamp', 'hmac']) {
		if (url.searchParams.getAll(key).length !== 1 || !url.searchParams.get(key)) {
			throw new PublicError(
				400,
				'LAUNCH_PARAMETER_MISSING',
				`Cafe24 실행 파라미터 ${key}가 없습니다.`
			);
		}
	}
	const context: Cafe24LaunchContext = {
		mallId: normalizeMallId(url.searchParams.get('mall_id')),
		shopNo: normalizeShopNo(url.searchParams.get('shop_no')),
		userId: normalizeUserId(url.searchParams.get('user_id')),
		rawQuery: url.search.slice(1),
		hmac: url.searchParams.get('hmac')!,
		timestamp: url.searchParams.get('timestamp')!
	};
	if (canSkipLaunchHmac()) return context;
	const requestTime = Number(context.timestamp) * 1000;
	if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > 2 * 60 * 60_000) {
		throw new PublicError(400, 'LAUNCH_EXPIRED', 'Cafe24 앱 실행 요청이 만료되었습니다.');
	}
	const expected = createHmac('sha256', getCafe24ClientSecret())
		.update(buildSignedPayload(context.rawQuery))
		.digest();
	const received = Buffer.from(context.hmac, 'base64');
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
		throw new PublicError(400, 'LAUNCH_HMAC_INVALID', 'Cafe24 앱 실행 서명이 올바르지 않습니다.');
	}
	return context;
}

function buildSignedPayload(rawQuery: string) {
	const signed: Array<{ key: string; pair: string }> = [];
	const seen = new Set<string>();
	for (const pair of rawQuery.split('&').filter(Boolean)) {
		const separator = pair.indexOf('=');
		const rawKey = separator === -1 ? pair : pair.slice(0, separator);
		let key: string;
		try {
			key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
		} catch {
			throw new PublicError(
				400,
				'LAUNCH_PARAMETER_INVALID',
				'Cafe24 실행 파라미터 인코딩이 올바르지 않습니다.'
			);
		}
		if (key === 'hmac' || !SIGNED_KEYS.includes(key as (typeof SIGNED_KEYS)[number])) continue;
		if (seen.has(key)) {
			throw new PublicError(
				400,
				'LAUNCH_PARAMETER_INVALID',
				'Cafe24 실행 파라미터가 중복되었습니다.'
			);
		}
		seen.add(key);
		signed.push({ key, pair });
	}
	return signed
		.sort((left, right) => left.key.localeCompare(right.key))
		.map(({ pair }) => pair)
		.join('&');
}

function normalizeUserId(value: string | null) {
	const normalized = value?.trim() ?? '';
	return normalized && normalized.length <= 128 ? normalized : null;
}

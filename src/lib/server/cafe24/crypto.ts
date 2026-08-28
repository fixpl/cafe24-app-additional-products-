import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual
} from 'node:crypto';
import { CAFE24_REQUIRED_SCOPES, type TokenEnvelopeRecord } from '$lib/shared/types';
import {
	getCafe24ClientId,
	getOauthStateSecret,
	getTokenEncryptionKeys,
	type EncryptionKeyEntry
} from '$lib/server/env';
import { PublicError } from '$lib/server/http';

const ENVELOPE_PURPOSE = 'cafe24-additional-products:token:v1';
const MAX_ENVELOPE_LENGTH = 12_000;

export interface TokenPayload {
	accessToken: string;
	refreshToken: string;
	accessTokenExpiresAt: string;
	refreshTokenExpiresAt: string;
	clientId: string;
	mallId: string;
	shopNo: string;
	userId: string | null;
	scopes: string[];
	issuedAt: string;
	sessionBindingHash: string;
}

interface EnvelopeHeader {
	v: 1;
	alg: 'A256GCM';
	kid: string;
	mallId: string;
	sessionBindingHash: string;
}

interface SerializedEnvelope extends EnvelopeHeader {
	iv: string;
	tag: string;
	ciphertext: string;
}

export interface OAuthStatePayload {
	v: 1;
	mallId: string;
	shopNo: string;
	userId: string | null;
	mode: 'launch';
	nonce: string;
	issuedAt: number;
	expiresAt: number;
}

export interface CryptoOptions {
	keys?: EncryptionKeyEntry[];
	clientId?: string;
}

function encode(value: Buffer | string) {
	return Buffer.from(value).toString('base64url');
}

function decode(value: string) {
	return Buffer.from(value, 'base64url');
}

function canonicalHeader(header: EnvelopeHeader, clientId: string) {
	return Buffer.from(
		JSON.stringify({
			purpose: ENVELOPE_PURPOSE,
			v: header.v,
			alg: header.alg,
			kid: header.kid,
			mallId: header.mallId,
			sessionBindingHash: header.sessionBindingHash,
			clientId
		}),
		'utf8'
	);
}

function getCryptoContext(options: CryptoOptions) {
	const keys = options.keys ?? getTokenEncryptionKeys();
	if (!keys[0]) throw new Error('활성 암호화 키가 없습니다.');
	return { keys, clientId: options.clientId ?? getCafe24ClientId() };
}

export function encryptTokenPayload(payload: TokenPayload, options: CryptoOptions = {}) {
	validateTokenPayload(payload);
	const { keys, clientId } = getCryptoContext(options);
	if (payload.clientId !== clientId) {
		throw new PublicError(
			401,
			'CREDENTIAL_INVALID',
			'Cafe24 로그인 정보의 앱이 일치하지 않습니다.',
			true
		);
	}
	const active = keys[0];
	const header: EnvelopeHeader = {
		v: 1,
		alg: 'A256GCM',
		kid: active.kid,
		mallId: payload.mallId,
		sessionBindingHash: payload.sessionBindingHash
	};
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', active.key, iv);
	cipher.setAAD(canonicalHeader(header, clientId));
	const ciphertext = Buffer.concat([
		cipher.update(JSON.stringify(payload), 'utf8'),
		cipher.final()
	]);
	const serialized: SerializedEnvelope = {
		...header,
		iv: encode(iv),
		tag: encode(cipher.getAuthTag()),
		ciphertext: encode(ciphertext)
	};
	const envelope = encode(JSON.stringify(serialized));
	if (envelope.length > MAX_ENVELOPE_LENGTH) {
		throw new PublicError(
			502,
			'CREDENTIAL_TOO_LARGE',
			'Cafe24 로그인 정보를 안전하게 저장할 수 없습니다.'
		);
	}
	return envelope;
}

export function decryptTokenEnvelope(envelopeValue: string, options: CryptoOptions = {}) {
	if (!envelopeValue || envelopeValue.length > MAX_ENVELOPE_LENGTH) {
		throw new PublicError(
			401,
			'CREDENTIAL_INVALID',
			'저장된 로그인 정보가 올바르지 않습니다.',
			true
		);
	}
	const { keys, clientId } = getCryptoContext(options);
	let parsed: unknown;
	try {
		parsed = JSON.parse(decode(envelopeValue).toString('utf8'));
	} catch {
		throw new PublicError(
			401,
			'CREDENTIAL_INVALID',
			'저장된 로그인 정보가 올바르지 않습니다.',
			true
		);
	}
	const envelope = validateEnvelope(parsed);
	const entry = keys.find((candidate) => candidate.kid === envelope.kid);
	if (!entry) {
		throw new PublicError(
			401,
			'CREDENTIAL_KEY_RETIRED',
			'로그인 암호화 키가 변경되었습니다. 다시 로그인해주세요.',
			true
		);
	}
	const header: EnvelopeHeader = {
		v: envelope.v,
		alg: envelope.alg,
		kid: envelope.kid,
		mallId: envelope.mallId,
		sessionBindingHash: envelope.sessionBindingHash
	};
	let parsedPayload: unknown;
	try {
		const decipher = createDecipheriv('aes-256-gcm', entry.key, decode(envelope.iv));
		decipher.setAAD(canonicalHeader(header, clientId));
		decipher.setAuthTag(decode(envelope.tag));
		const plaintext = Buffer.concat([
			decipher.update(decode(envelope.ciphertext)),
			decipher.final()
		]);
		parsedPayload = JSON.parse(plaintext.toString('utf8'));
	} catch {
		throw new PublicError(
			401,
			'CREDENTIAL_INVALID',
			'저장된 로그인 정보 검증에 실패했습니다.',
			true
		);
	}
	const payload = validateTokenPayload(parsedPayload);
	if (
		payload.mallId !== envelope.mallId ||
		payload.sessionBindingHash !== envelope.sessionBindingHash ||
		payload.clientId !== clientId
	) {
		throw new PublicError(
			401,
			'CREDENTIAL_INVALID',
			'저장된 로그인 정보 검증에 실패했습니다.',
			true
		);
	}
	return { payload, needsKeyRotation: entry.kid !== keys[0].kid };
}

export function toTokenEnvelopeRecord(
	payload: TokenPayload,
	envelope: string
): TokenEnvelopeRecord {
	return {
		envelope,
		mallId: payload.mallId,
		shopNo: payload.shopNo,
		userId: payload.userId,
		accessTokenExpiresAt: payload.accessTokenExpiresAt,
		refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
		scopes: [...payload.scopes],
		savedAt: new Date().toISOString()
	};
}

export function createSessionBinding() {
	return encode(randomBytes(32));
}

export function hashSessionBinding(value: string) {
	return createHash('sha256').update(value, 'utf8').digest('base64url');
}

export function assertSessionBinding(payload: TokenPayload, sessionCookie: string | undefined) {
	if (!sessionCookie) {
		throw new PublicError(
			401,
			'SESSION_MISSING',
			'이 브라우저의 로그인 세션이 없습니다. 다시 로그인해주세요.',
			true
		);
	}
	const expected = Buffer.from(payload.sessionBindingHash, 'utf8');
	const received = Buffer.from(hashSessionBinding(sessionCookie), 'utf8');
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
		throw new PublicError(
			401,
			'SESSION_MISMATCH',
			'로그인 세션 검증에 실패했습니다. 다시 로그인해주세요.',
			true
		);
	}
}

export function signOAuthState(payload: OAuthStatePayload, secret = getOauthStateSecret()) {
	validateOAuthStatePayload(payload, Date.now(), false);
	const body = encode(JSON.stringify(payload));
	const signature = createHmac('sha256', secret).update(body).digest('base64url');
	return `v1.${body}.${signature}`;
}

export function verifyOAuthState(value: string, now = Date.now(), secret = getOauthStateSecret()) {
	if (!value || value.length > 4096) {
		throw new PublicError(400, 'OAUTH_STATE_INVALID', 'OAuth state 형식이 올바르지 않습니다.');
	}
	const [version, body, signature, extra] = value.split('.');
	if (
		version !== 'v1' ||
		!body ||
		!signature ||
		extra ||
		!isBase64Url(body) ||
		!isBase64Url(signature)
	) {
		throw new PublicError(400, 'OAUTH_STATE_INVALID', 'OAuth state 형식이 올바르지 않습니다.');
	}
	const expected = createHmac('sha256', secret).update(body).digest();
	const received = decode(signature);
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
		throw new PublicError(400, 'OAUTH_STATE_INVALID', 'OAuth state 검증에 실패했습니다.');
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(decode(body).toString('utf8'));
	} catch {
		throw new PublicError(400, 'OAUTH_STATE_INVALID', 'OAuth state 형식이 올바르지 않습니다.');
	}
	return validateOAuthStatePayload(parsed, now, true);
}

export function stateCookieValue(state: string) {
	return createHash('sha256').update(state, 'utf8').digest('base64url');
}

export function assertStateCookie(state: string, cookie: string | undefined) {
	if (!cookie) {
		throw new PublicError(
			400,
			'OAUTH_COOKIE_MISSING',
			'OAuth 로그인 쿠키가 없습니다. 다시 시작해주세요.'
		);
	}
	const expected = Buffer.from(stateCookieValue(state), 'utf8');
	const received = Buffer.from(cookie, 'utf8');
	if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
		throw new PublicError(400, 'OAUTH_COOKIE_MISMATCH', 'OAuth 로그인 요청이 일치하지 않습니다.');
	}
}

function validateEnvelope(value: unknown): SerializedEnvelope {
	if (!isRecord(value)) return invalidEnvelope();
	if (
		value.v !== 1 ||
		value.alg !== 'A256GCM' ||
		typeof value.kid !== 'string' ||
		!/^[A-Za-z0-9_-]{1,32}$/.test(value.kid) ||
		typeof value.mallId !== 'string' ||
		!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(value.mallId) ||
		typeof value.sessionBindingHash !== 'string' ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.sessionBindingHash) ||
		typeof value.iv !== 'string' ||
		!/^[A-Za-z0-9_-]{16}$/.test(value.iv) ||
		typeof value.tag !== 'string' ||
		!/^[A-Za-z0-9_-]{22}$/.test(value.tag) ||
		typeof value.ciphertext !== 'string' ||
		!/^[A-Za-z0-9_-]+$/.test(value.ciphertext) ||
		decode(value.iv).length !== 12 ||
		decode(value.tag).length !== 16 ||
		decode(value.ciphertext).length === 0
	) {
		return invalidEnvelope();
	}
	return value as unknown as SerializedEnvelope;
}

function invalidEnvelope(): never {
	throw new PublicError(401, 'CREDENTIAL_INVALID', '저장된 로그인 정보가 올바르지 않습니다.', true);
}

function validateTokenPayload(value: unknown): TokenPayload {
	if (!isRecord(value) || !Array.isArray(value.scopes)) return invalidTokenPayload();
	const scopes = value.scopes;
	const uniqueScopes = [...new Set(scopes)].sort();
	const required = [...CAFE24_REQUIRED_SCOPES].sort();
	if (
		typeof value.accessToken !== 'string' ||
		!value.accessToken ||
		value.accessToken.length > 4096 ||
		typeof value.refreshToken !== 'string' ||
		!value.refreshToken ||
		value.refreshToken.length > 4096 ||
		typeof value.clientId !== 'string' ||
		!value.clientId ||
		typeof value.mallId !== 'string' ||
		!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(value.mallId) ||
		typeof value.shopNo !== 'string' ||
		!/^\d{1,10}$/.test(value.shopNo) ||
		(value.userId !== null && (typeof value.userId !== 'string' || value.userId.length > 128)) ||
		typeof value.sessionBindingHash !== 'string' ||
		!/^[A-Za-z0-9_-]{43}$/.test(value.sessionBindingHash) ||
		typeof value.accessTokenExpiresAt !== 'string' ||
		!Number.isFinite(Date.parse(value.accessTokenExpiresAt)) ||
		typeof value.refreshTokenExpiresAt !== 'string' ||
		!Number.isFinite(Date.parse(value.refreshTokenExpiresAt)) ||
		typeof value.issuedAt !== 'string' ||
		!Number.isFinite(Date.parse(value.issuedAt)) ||
		Date.parse(value.refreshTokenExpiresAt) <= Date.parse(value.issuedAt) ||
		!scopes.every((scope) => typeof scope === 'string') ||
		uniqueScopes.length !== required.length ||
		uniqueScopes.some((scope, index) => scope !== required[index])
	) {
		return invalidTokenPayload();
	}
	return value as unknown as TokenPayload;
}

function invalidTokenPayload(): never {
	throw new PublicError(
		401,
		'CREDENTIAL_INVALID',
		'Cafe24 로그인 정보의 범위 또는 만료 정보가 올바르지 않습니다.',
		true
	);
}

function validateOAuthStatePayload(
	value: unknown,
	now: number,
	enforceTime: boolean
): OAuthStatePayload {
	if (!isRecord(value)) return invalidOAuthState();
	if (
		value.v !== 1 ||
		typeof value.mallId !== 'string' ||
		!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(value.mallId) ||
		typeof value.shopNo !== 'string' ||
		!/^\d{1,10}$/.test(value.shopNo) ||
		(value.userId !== null && (typeof value.userId !== 'string' || value.userId.length > 128)) ||
		value.mode !== 'launch' ||
		typeof value.nonce !== 'string' ||
		!/^[-0-9a-f]{16,64}$/i.test(value.nonce) ||
		typeof value.issuedAt !== 'number' ||
		!Number.isFinite(value.issuedAt) ||
		typeof value.expiresAt !== 'number' ||
		!Number.isFinite(value.expiresAt) ||
		value.expiresAt <= value.issuedAt ||
		value.expiresAt - value.issuedAt > 10 * 60_000 ||
		(enforceTime && (value.issuedAt > now + 30_000 || value.expiresAt < now))
	) {
		return invalidOAuthState();
	}
	return value as unknown as OAuthStatePayload;
}

function invalidOAuthState(): never {
	throw new PublicError(
		400,
		'OAUTH_STATE_INVALID',
		'OAuth 로그인 요청이 올바르지 않거나 만료되었습니다.'
	);
}

function isBase64Url(value: string) {
	return /^[A-Za-z0-9_-]+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

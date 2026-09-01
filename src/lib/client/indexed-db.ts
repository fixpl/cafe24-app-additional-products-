import type { TokenEnvelopeRecord, UploadJobRecord } from '$lib/shared/types';

const DATABASE_NAME = 'cafe24-additional-products';
const DATABASE_VERSION = 2;
const CREDENTIAL_STORE = 'credential';
const JOB_STORE = 'jobs';
const ACTIVE_CREDENTIAL_KEY = 'active';

function openDatabase(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') {
		return Promise.reject(new Error('이 브라우저에서는 IndexedDB를 사용할 수 없습니다.'));
	}
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(CREDENTIAL_STORE)) db.createObjectStore(CREDENTIAL_STORE);
			if (!db.objectStoreNames.contains(JOB_STORE))
				db.createObjectStore(JOB_STORE, { keyPath: 'id' });
		};
		request.onsuccess = () => {
			const db = request.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열지 못했습니다.'));
		request.onblocked = () =>
			reject(new Error('다른 탭이 저장소 업데이트를 막고 있습니다. 다른 탭을 닫아주세요.'));
	});
}

export async function loadTokenCredential() {
	const value = await readStore(CREDENTIAL_STORE, ACTIVE_CREDENTIAL_KEY);
	return isTokenEnvelopeRecord(value) ? value : null;
}

export function saveTokenCredential(record: TokenEnvelopeRecord) {
	if (!isTokenEnvelopeRecord(record))
		return Promise.reject(new Error('암호화 로그인 정보 형식이 올바르지 않습니다.'));
	return writeStore(CREDENTIAL_STORE, record, ACTIVE_CREDENTIAL_KEY);
}

export function clearTokenCredential() {
	return deleteFromStore(CREDENTIAL_STORE, ACTIVE_CREDENTIAL_KEY);
}

export async function loadUploadJobs() {
	const values = await readAll(JOB_STORE);
	return values
		.filter(isUploadJobRecord)
		.sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
		.slice(0, 30);
}

export function saveUploadJob(record: UploadJobRecord) {
	if (!isUploadJobRecord(record))
		return Promise.reject(new Error('업로드 기록 형식이 올바르지 않습니다.'));
	return writeStore(JOB_STORE, record);
}

export function deleteUploadJob(jobId: string) {
	if (!jobId) return Promise.reject(new Error('삭제할 업로드 기록을 찾지 못했습니다.'));
	return deleteFromStore(JOB_STORE, jobId);
}

export function clearUploadJobs() {
	return clearStore(JOB_STORE);
}

export async function withCredentialLock<T>(task: () => Promise<T>): Promise<T> {
	if (navigator.locks?.request) {
		return navigator.locks.request(
			'cafe24-additional-products-credential',
			{ mode: 'exclusive' },
			task
		);
	}
	return task();
}

async function readStore(storeName: string, key: IDBValidKey): Promise<unknown> {
	const db = await openDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error('IndexedDB 읽기에 실패했습니다.'));
		});
	} finally {
		db.close();
	}
}

async function readAll(storeName: string): Promise<unknown[]> {
	const db = await openDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error ?? new Error('IndexedDB 읽기에 실패했습니다.'));
		});
	} finally {
		db.close();
	}
}

async function writeStore(storeName: string, value: unknown, key?: IDBValidKey) {
	const db = await openDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(storeName, 'readwrite');
			const store = transaction.objectStore(storeName);
			if (key === undefined) store.put(value);
			else store.put(value, key);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error('IndexedDB 저장에 실패했습니다.'));
			transaction.onabort = () =>
				reject(transaction.error ?? new Error('IndexedDB 저장이 취소되었습니다.'));
		});
	} finally {
		db.close();
	}
}

async function deleteFromStore(storeName: string, key: IDBValidKey) {
	const db = await openDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(storeName, 'readwrite');
			transaction.objectStore(storeName).delete(key);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error('IndexedDB 삭제에 실패했습니다.'));
		});
	} finally {
		db.close();
	}
}

async function clearStore(storeName: string) {
	const db = await openDatabase();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(storeName, 'readwrite');
			transaction.objectStore(storeName).clear();
			transaction.oncomplete = () => resolve();
			transaction.onerror = () =>
				reject(transaction.error ?? new Error('IndexedDB 기록 삭제에 실패했습니다.'));
			transaction.onabort = () =>
				reject(transaction.error ?? new Error('IndexedDB 기록 삭제가 취소되었습니다.'));
		});
	} finally {
		db.close();
	}
}

function isTokenEnvelopeRecord(value: unknown): value is TokenEnvelopeRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.envelope === 'string' &&
		record.envelope.length > 0 &&
		record.envelope.length <= 12_000 &&
		typeof record.mallId === 'string' &&
		typeof record.shopNo === 'string' &&
		(record.userId === null || typeof record.userId === 'string') &&
		typeof record.accessTokenExpiresAt === 'string' &&
		typeof record.refreshTokenExpiresAt === 'string' &&
		Array.isArray(record.scopes) &&
		record.scopes.every((scope) => typeof scope === 'string') &&
		typeof record.savedAt === 'string'
	);
}

function isUploadJobRecord(value: unknown): value is UploadJobRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.id === 'string' &&
		typeof record.fileName === 'string' &&
		typeof record.startedAt === 'string' &&
		['running', 'completed', 'cancelled'].includes(String(record.status)) &&
		Number.isInteger(record.successCount) &&
		Number.isInteger(record.failureCount) &&
		Number.isInteger(record.total) &&
		Array.isArray(record.results)
	);
}

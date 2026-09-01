export const CAFE24_REQUIRED_SCOPES = [
	'mall.read_product',
	'mall.write_product',
	'mall.read_application',
	'mall.write_application'
] as const;
export type AdditionalProductMethod = 'POST' | 'PUT';

export interface AdditionalProductOperation {
	row: number;
	productNo: number;
	additionalProducts: number[];
}

export interface CsvIssue {
	row: number;
	column?: string;
	message: string;
}

export interface TokenEnvelopeRecord {
	envelope: string;
	mallId: string;
	shopNo: string;
	userId: string | null;
	accessTokenExpiresAt: string;
	refreshTokenExpiresAt: string;
	scopes: string[];
	savedAt: string;
}

export interface AuthStatus {
	mallId: string;
	shopNo: string;
	userId: string | null;
	accessTokenExpiresAt: string;
	refreshTokenExpiresAt: string;
	scopes: string[];
}

export interface RateLimitSummary {
	callUsage: string | null;
	callRemain: string | null;
	timeUsage: string | null;
	timeRemain: string | null;
}

export interface AdditionalProductResult {
	ok: boolean;
	status: number;
	method: AdditionalProductMethod | null;
	productNo: number;
	additionalProducts: number[];
	totalCount: number | null;
	message: string;
	rateLimit: RateLimitSummary;
}

export interface AdditionalProductApiResponse {
	ok: true;
	result: AdditionalProductResult;
	credential: TokenEnvelopeRecord | null;
}

export interface ApiErrorResponse {
	ok: false;
	error: { code: string; message: string; reauthorize: boolean };
}

export interface UploadJobResult {
	row: number;
	productNo: number;
	method: AdditionalProductMethod | null;
	ok: boolean;
	message: string;
}

export interface UploadJobRecord {
	id: string;
	fileName: string;
	startedAt: string;
	completedAt?: string;
	successCount: number;
	failureCount: number;
	total: number;
	status: 'running' | 'completed' | 'cancelled';
	results: UploadJobResult[];
}

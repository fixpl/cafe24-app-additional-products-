export const CAFE24_REQUIRED_SCOPES = [
	'mall.read_product',
	'mall.write_product',
	'mall.read_application',
	'mall.write_application'
] as const;
export type AdditionalProductMethod = 'POST' | 'PUT';

/** CSV/XLSX에 입력된 상품번호 또는 Cafe24 상품코드입니다. */
export type ProductIdentifier = number | string;

/** Cafe24 상품번호로 변환하기 전, 파일에서 읽은 추가구성상품 행입니다. */
export interface AdditionalProductInputOperation {
	row: number;
	productNo: ProductIdentifier;
	additionalProducts: ProductIdentifier[];
}

export interface AdditionalProductOperation {
	row: number;
	productNo: number;
	additionalProducts: number[];
}

export interface ProductCodeResolution {
	productCode: string;
	productNo: number | null;
	message: string | null;
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

export interface ProductCodeResolveApiResponse {
	ok: true;
	resolutions: ProductCodeResolution[];
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
	/** CSV에서 요청한 추가구성상품 번호입니다. 기존 기록에는 없을 수 있습니다. */
	requestedAdditionalProducts?: number[];
	/** Cafe24 응답에 포함된 추가구성상품 번호입니다. */
	returnedAdditionalProducts?: number[] | null;
	/** 앱 endpoint 또는 Cafe24 요청의 HTTP 상태입니다. */
	httpStatus?: number | null;
	/** Cafe24 응답의 total_count입니다. */
	totalCount?: number | null;
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

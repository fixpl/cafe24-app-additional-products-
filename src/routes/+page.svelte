<script lang="ts">
	import { onMount } from 'svelte';
	import UploadWorkspace from '$lib/components/UploadWorkspace.svelte';
	import {
		clearTokenCredential,
		loadTokenCredential,
		loadUploadJobs,
		saveTokenCredential,
		saveUploadJob,
		withCredentialLock
	} from '$lib/client/indexed-db';
	import { createTemplateCsv, parseAdditionalProductsCsv } from '$lib/csv/additional-products';
	import type {
		AdditionalProductApiResponse,
		AdditionalProductOperation,
		ApiErrorResponse,
		AuthStatus,
		CsvIssue,
		TokenEnvelopeRecord,
		UploadJobRecord
	} from '$lib/shared/types';
	import type { PageData } from './$types';

	interface Banner {
		kind: 'error' | 'success' | 'info';
		message: string;
	}

	interface DisplaySummary {
		total: number;
		creates: number;
		updates: number;
		success: number;
		failure: number;
		processedAt: string;
	}

	type DisplayJob = UploadJobRecord & { note?: string };

	interface AuthApiSuccess {
		ok: true;
		auth: AuthStatus;
		credential: TokenEnvelopeRecord | null;
	}

	const ACCESS_TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;
	const MAX_SCHEDULED_REFRESH_DELAY_MS = 30 * 60_000;
	const REFRESH_RETRY_DELAY_MS = 60_000;

	class ApiFailure extends Error {
		readonly reauthorize: boolean;

		constructor(message: string, reauthorize = false) {
			super(message);
			this.reauthorize = reauthorize;
		}
	}

	let { data }: { data: PageData } = $props();
	let loading = $state(true);
	let auth = $state<AuthStatus | null>(null);
	let credential = $state<TokenEnvelopeRecord | null>(null);
	let selectedFile = $state<File | null>(null);
	let operations = $state<AdditionalProductOperation[]>([]);
	let issues = $state<CsvIssue[]>([]);
	let summary = $state<DisplaySummary | null>(null);
	let jobs = $state<DisplayJob[]>([]);
	let banner = $state<Banner | null>(null);
	let running = $state(false);
	let progressCurrent = $state(0);
	let progressTotal = $state(0);
	let progressLabel = $state('');
	let activeController = $state<AbortController | null>(null);
	let cancelRequested = false;
	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	let credentialRefreshRunning = false;

	const phase = $derived(
		data.invalidAccess
			? 'signed-out'
			: loading
				? 'loading'
				: running
					? 'running'
					: auth
						? 'ready'
						: 'signed-out'
	);
	const canApply = $derived(
		Boolean(
			auth && credential && selectedFile && operations.length > 0 && issues.length === 0 && !running
		)
	);
	const progress = $derived(
		running ? { current: progressCurrent, total: progressTotal, label: progressLabel } : null
	);

	onMount(() => {
		if (data.invalidAccess) {
			loading = false;
			return;
		}
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') void refreshCredential();
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		void bootstrap();
		return () => {
			clearScheduledCredentialRefresh();
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	});

	async function bootstrap() {
		try {
			const loadedJobs = await loadUploadJobs();
			const recoveredAt = new Date().toISOString();
			jobs = loadedJobs.map((job) =>
				job.status === 'running'
					? {
							...job,
							status: 'cancelled',
							completedAt: recoveredAt,
							note: '이전 브라우저 실행에서 중단된 작업입니다.'
						}
					: job
			);
			for (const job of jobs.filter((candidate) => candidate.completedAt === recoveredAt)) {
				await saveUploadJob(job);
			}

			const stored = await loadTokenCredential();
			if (!stored) return;
			const response = await fetch('/api/auth/status', {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/json' },
				body: JSON.stringify({ envelope: stored.envelope })
			});
			const payload = (await response.json()) as AuthApiSuccess | ApiErrorResponse;
			if (!response.ok || !payload.ok) {
				await clearTokenCredential();
				banner = {
					kind: 'error',
					message: payload.ok ? '로그인 상태를 확인하지 못했습니다.' : payload.error.message
				};
				return;
			}
			credential = payload.credential ?? stored;
			auth = payload.auth;
			if (payload.credential) await saveTokenCredential(payload.credential);
			scheduleCredentialRefresh();
		} catch (error) {
			banner = {
				kind: 'error',
				message: error instanceof Error ? error.message : '로컬 로그인 정보를 확인하지 못했습니다.'
			};
		} finally {
			loading = false;
		}
	}

	function clearScheduledCredentialRefresh() {
		if (refreshTimer !== null) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
	}

	function scheduleCredentialRefresh(delayOverride?: number) {
		clearScheduledCredentialRefresh();
		if (!credential) return;
		const expiresAt = Date.parse(credential.accessTokenExpiresAt);
		const scheduledDelay =
			delayOverride ??
			(Number.isFinite(expiresAt)
				? Math.max(0, expiresAt - Date.now() - ACCESS_TOKEN_REFRESH_BUFFER_MS)
				: 0);
		refreshTimer = setTimeout(
			() => void refreshCredential(),
			Math.min(scheduledDelay, MAX_SCHEDULED_REFRESH_DELAY_MS)
		);
	}

	async function refreshCredential() {
		if (!credential) return;
		if (credentialRefreshRunning || running) {
			scheduleCredentialRefresh(running ? REFRESH_RETRY_DELAY_MS : undefined);
			return;
		}
		credentialRefreshRunning = true;
		try {
			await withCredentialLock(async () => {
				const activeCredential = credential;
				if (!activeCredential) return;
				const response = await fetch('/api/auth/refresh', {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({ envelope: activeCredential.envelope })
				});
				const payload = (await response.json()) as AuthApiSuccess | ApiErrorResponse;
				if (!response.ok || !payload.ok) {
					if (!payload.ok && payload.error.reauthorize) {
						await clearTokenCredential();
						credential = null;
						auth = null;
						clearScheduledCredentialRefresh();
						banner = { kind: 'error', message: payload.error.message };
						return;
					}
					scheduleCredentialRefresh(REFRESH_RETRY_DELAY_MS);
					return;
				}
				auth = payload.auth;
				if (payload.credential) {
					credential = payload.credential;
					await saveTokenCredential(payload.credential);
				}
				scheduleCredentialRefresh();
			});
		} catch {
			scheduleCredentialRefresh(REFRESH_RETRY_DELAY_MS);
		} finally {
			credentialRefreshRunning = false;
		}
	}

	async function selectFile(file: File) {
		selectedFile = file;
		operations = [];
		issues = [];
		summary = null;
		banner = null;
		if (!file.name.toLowerCase().endsWith('.csv')) {
			issues = [{ row: 1, message: 'UTF-8 CSV 파일만 업로드할 수 있습니다.' }];
			return;
		}
		if (file.size > 1024 * 1024) {
			issues = [{ row: 1, message: 'CSV 파일은 1MB 이하여야 합니다.' }];
			return;
		}
		try {
			const text = await file.text();
			if (text.includes('\uFFFD') || text.includes('\0')) {
				issues = [{ row: 1, message: 'CSV 파일을 UTF-8 형식으로 다시 저장해주세요.' }];
				return;
			}
			const parsed = parseAdditionalProductsCsv(text);
			operations = parsed.operations;
			issues = parsed.issues;
			if (operations.length === 0 && issues.length === 0) {
				issues = [{ row: 2, message: '처리할 데이터 행이 없습니다.' }];
			}
			banner = issues.length
				? {
						kind: 'error',
						message: `CSV에서 ${issues.length}개의 오류를 확인했습니다. 오류를 모두 수정한 뒤 다시 선택해주세요.`
					}
				: {
						kind: 'success',
						message: `${operations.length}개 행을 확인했습니다. 업로드 시 현재 추가구성상품 설정을 조회해 등록 또는 수정을 자동 선택합니다.`
					};
		} catch {
			issues = [{ row: 1, message: 'CSV 파일을 읽지 못했습니다.' }];
		}
	}

	function downloadTemplate() {
		const blob = new Blob([createTemplateCsv()], { type: 'text/csv;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'cafe24-additional-products-template.csv';
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function cancelUpload() {
		cancelRequested = true;
		activeController?.abort();
	}

	async function applyUpload() {
		if (!canApply || !selectedFile || !credential) return;
		const batchOperations = [...operations];
		const fileName = selectedFile.name;
		const jobId = crypto.randomUUID();
		const startedAt = new Date().toISOString();
		let job: DisplayJob = {
			id: jobId,
			fileName,
			startedAt,
			successCount: 0,
			failureCount: 0,
			total: batchOperations.length,
			status: 'running',
			results: [],
			note: 'Cafe24에 순서대로 반영하고 있습니다.'
		};
		jobs = [job, ...jobs];
		await saveUploadJob(job);
		running = true;
		cancelRequested = false;
		progressCurrent = 0;
		progressTotal = batchOperations.length;
		progressLabel = '현재 설정을 확인하고 반영을 준비하고 있습니다.';
		banner = { kind: 'info', message: 'Cafe24 추가구성상품 반영을 시작했습니다.' };

		try {
			await withCredentialLock(async () => {
				for (const operation of batchOperations) {
					if (cancelRequested) break;
					progressLabel = `${operation.row}행 · 기준상품 ${operation.productNo}`;
					const controller = new AbortController();
					activeController = controller;
					try {
						const result = await applyOperation(operation, controller.signal);
						job.results.push({
							row: operation.row,
							productNo: operation.productNo,
							method: result.method,
							ok: result.ok,
							message: result.message
						});
						if (result.ok) job.successCount += 1;
						else {
							job.failureCount += 1;
							if (result.status === 429) {
								cancelRequested = true;
								banner = {
									kind: 'error',
									message: 'Cafe24 API 호출 한도에 도달해 남은 행 처리를 중단했습니다.'
								};
							}
						}
					} catch (error) {
						if (isAbort(error)) {
							cancelRequested = true;
							break;
						}
						const failure =
							error instanceof ApiFailure
								? error
								: new ApiFailure('호출 결과를 확인할 수 없어 작업을 중단했습니다.');
						job.results.push({
							row: operation.row,
							productNo: operation.productNo,
							method: null,
							ok: false,
							message: failure.message
						});
						job.failureCount += 1;
						if (failure.reauthorize) {
							await clearTokenCredential();
							credential = null;
							auth = null;
							clearScheduledCredentialRefresh();
						}
						cancelRequested = true;
						banner = { kind: 'error', message: failure.message };
						break;
					} finally {
						activeController = null;
					}
					progressCurrent = job.results.length;
					job = { ...job, results: [...job.results] };
					jobs = jobs.map((candidate) => (candidate.id === job.id ? job : candidate));
					await saveUploadJob(job);
					if (!cancelRequested && progressCurrent < progressTotal) await pause(550);
				}
			});
		} finally {
			const cancelled = cancelRequested && job.results.length < job.total;
			job = {
				...job,
				status: cancelled ? 'cancelled' : 'completed',
				completedAt: new Date().toISOString(),
				results: [...job.results],
				note: cancelled
					? `중단됨 · ${job.results.length}/${job.total}행 처리`
					: `완료 · 성공 ${job.successCount}건 · 실패 ${job.failureCount}건`
			};
			jobs = jobs.map((candidate) => (candidate.id === job.id ? job : candidate));
			await saveUploadJob(job);
			summary = makeSummary(batchOperations, job.results);
			issues = job.results
				.filter((result) => !result.ok)
				.map((result) => ({ row: result.row, message: result.message }));
			if (!banner || banner.kind === 'info') {
				banner = cancelled
					? {
							kind: 'info',
							message: `작업을 중단했습니다. ${job.results.length}/${job.total}행을 처리했습니다.`
						}
					: job.failureCount > 0
						? { kind: 'error', message: `반영을 마쳤지만 ${job.failureCount}개 행이 실패했습니다.` }
						: { kind: 'success', message: `${job.successCount}개 행을 Cafe24에 반영했습니다.` };
			}
			running = false;
			activeController = null;
			cancelRequested = false;
			scheduleCredentialRefresh();
		}
	}

	async function applyOperation(operation: AdditionalProductOperation, signal: AbortSignal) {
		if (!credential) throw new ApiFailure('Cafe24 로그인이 필요합니다.', true);
		const response = await fetch('/api/additional-products', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify({ envelope: credential.envelope, operation }),
			signal
		});
		const payload = (await response.json()) as AdditionalProductApiResponse | ApiErrorResponse;
		if (!response.ok || !payload.ok) {
			throw new ApiFailure(
				payload.ok ? 'Cafe24 요청이 실패했습니다.' : payload.error.message,
				payload.ok ? false : payload.error.reauthorize
			);
		}
		if (payload.credential) {
			credential = payload.credential;
			auth = {
				mallId: payload.credential.mallId,
				shopNo: payload.credential.shopNo,
				userId: payload.credential.userId,
				accessTokenExpiresAt: payload.credential.accessTokenExpiresAt,
				refreshTokenExpiresAt: payload.credential.refreshTokenExpiresAt,
				scopes: [...payload.credential.scopes]
			};
			await saveTokenCredential(payload.credential);
			scheduleCredentialRefresh();
		}
		return payload.result;
	}

	function makeSummary(
		items: AdditionalProductOperation[],
		results: UploadJobRecord['results']
	): DisplaySummary {
		return {
			total: items.length,
			creates: results.filter((result) => result.method === 'POST').length,
			updates: results.filter((result) => result.method === 'PUT').length,
			success: results.filter((result) => result.ok).length,
			failure: results.filter((result) => !result.ok).length,
			processedAt: new Date().toISOString()
		};
	}

	function isAbort(error: unknown) {
		return error instanceof Error && error.name === 'AbortError';
	}

	function pause(milliseconds: number) {
		return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
	}
</script>

<div class="app-shell">
	<section class="page-card">
		<UploadWorkspace
			{auth}
			{phase}
			selectedFileName={selectedFile?.name ?? null}
			{summary}
			{issues}
			{progress}
			{jobs}
			{canApply}
			handlers={{
				onFile: selectFile,
				onDownload: downloadTemplate,
				onApply: applyUpload,
				onCancel: cancelUpload
			}}
			{banner}
		/>
	</section>
</div>

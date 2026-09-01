<script module lang="ts">
	export interface UploadWorkspaceAuth {
		mallId: string;
		shopNo: string | null;
		accessTokenExpiresAt: string;
		refreshTokenExpiresAt: string;
		scopes: string[];
	}

	export interface UploadWorkspaceSummary {
		total: number;
		creates: number;
		updates: number;
		success: number;
		failure: number;
		processedAt: string;
	}

	export interface UploadWorkspaceIssue {
		row: number;
		message: string;
	}

	export interface UploadWorkspaceProgress {
		current: number;
		total: number;
		label?: string;
	}

	export interface UploadWorkspaceJobResult {
		row: number;
		productNo: number;
		method: 'POST' | 'PUT' | null;
		ok: boolean;
		message: string;
		requestedAdditionalProducts?: number[];
		returnedAdditionalProducts?: number[] | null;
		httpStatus?: number | null;
		totalCount?: number | null;
	}

	export interface UploadWorkspaceJob {
		id: string;
		fileName: string;
		startedAt: string;
		completedAt?: string;
		successCount: number;
		failureCount: number;
		total: number;
		status: 'running' | 'completed' | 'cancelled';
		results: UploadWorkspaceJobResult[];
		note?: string;
	}

	export interface UploadWorkspaceHandlers {
		onFile: (file: File) => void;
		onDownload: () => void;
		onDownloadResults: (jobId: string) => void;
		onDeleteCompletedJob: (jobId: string) => void;
		onClearCompletedJobs: () => void;
		onApply: () => void;
		onCancel: () => void;
	}

	export interface UploadWorkspaceBanner {
		kind: 'error' | 'success' | 'info';
		message: string;
	}
</script>

<script lang="ts">
	import Icon from '@iconify/svelte';
	import uploadIcon from '@iconify-icons/material-symbols/cloud-upload-outline-rounded';
	import deleteIcon from '@iconify-icons/material-symbols/delete-outline-rounded';
	import deleteSweepIcon from '@iconify-icons/material-symbols/delete-sweep-outline-rounded';
	import downloadIcon from '@iconify-icons/material-symbols/download-rounded';
	import pendingIcon from '@iconify-icons/material-symbols/sync-rounded';
	import successIcon from '@iconify-icons/material-symbols/check-circle-rounded';
	import warningIcon from '@iconify-icons/material-symbols/warning-outline-rounded';

	interface Props {
		auth: UploadWorkspaceAuth | null;
		phase: 'loading' | 'signed-out' | 'ready' | 'running';
		selectedFileName: string | null;
		summary: UploadWorkspaceSummary | null;
		issues: UploadWorkspaceIssue[];
		progress: UploadWorkspaceProgress | null;
		jobs: UploadWorkspaceJob[];
		handlers: UploadWorkspaceHandlers;
		banner?: UploadWorkspaceBanner | null;
		canApply?: boolean;
	}

	let {
		auth,
		phase,
		selectedFileName,
		summary,
		issues,
		progress,
		jobs,
		handlers,
		banner = null,
		canApply = false
	}: Props = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let dragActive = $state(false);
	let expandedResultJobId = $state<string | null>(null);

	const runningJobs = $derived(jobs.filter((job) => job.status === 'running'));
	const finishedJobs = $derived(jobs.filter((job) => job.status !== 'running'));
	const applyButtonLabel = $derived(
		phase === 'running'
			? 'Cafe24에 적용 중'
			: canApply
				? 'Cafe24에 적용하기'
				: summary?.failure
					? '실패 결과 확인 필요'
					: selectedFileName
						? 'CSV 확인 후 Cafe24에 적용'
						: '파일 선택 후 Cafe24에 적용'
	);

	function formatDate(value: string | undefined | null) {
		if (!value) return '-';

		const parsed = new Date(value);
		if (Number.isNaN(parsed.getTime())) {
			return value;
		}

		return new Intl.DateTimeFormat('ko-KR', {
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(parsed);
	}

	function openPicker() {
		fileInput?.click();
	}

	function handleDropzoneActivate() {
		if (!auth) return;
		openPicker();
	}

	function handleFileChange(event: Event) {
		const files = (event.currentTarget as HTMLInputElement).files;
		const file = files?.[0];
		if (file) {
			handlers.onFile(file);
		}
	}

	function handleDragEnter(event: DragEvent) {
		event.preventDefault();
		dragActive = true;
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		dragActive = true;
	}

	function handleDragLeave(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		dragActive = false;
		const file = event.dataTransfer?.files?.[0];
		if (file) {
			handlers.onFile(file);
		}
	}

	function toggleResults(jobId: string) {
		expandedResultJobId = expandedResultJobId === jobId ? null : jobId;
	}

	function formatProductNumbers(value: number[] | null | undefined) {
		return value && value.length > 0 ? value.join(', ') : '-';
	}

	function formatResponseSummary(
		httpStatus: number | null | undefined,
		totalCount: number | null | undefined
	) {
		const status = httpStatus ? `HTTP ${httpStatus}` : 'HTTP 상태 없음';
		return totalCount === null || totalCount === undefined
			? status
			: `${status} · 총 ${totalCount}개`;
	}
</script>

<svelte:head>
	<title>Cafe24 추가구성상품 엑셀 업로드</title>
</svelte:head>

<section class="workspace-shell">
	{#if phase === 'loading'}
		<section class="access-state" aria-live="polite" aria-busy="true">
			<div class="access-message">
				<h1>앱 접속 정보를 확인하고 있습니다.</h1>
				<p>잠시만 기다려 주세요.</p>
			</div>
		</section>
	{:else if phase === 'signed-out'}
		<section class="access-state" role="alert">
			<div class="access-message">
				<h1>정상적인 앱 접속이 아닙니다.</h1>
				<p>Cafe24 관리자에서 설치한 앱을 실행해 주세요.</p>
			</div>
		</section>
	{:else}
		<header class="workspace-header">
			<h1>추가구성상품 엑셀 업로드</h1>

			{#if auth}
				<div
					class="auth-pill"
					title="액세스 토큰 원문은 표시하지 않습니다. 괄호 안은 액세스 토큰 만료 시각입니다."
				>
					<span>몰 아이디: {auth.mallId} ({formatDate(auth.accessTokenExpiresAt)})</span>
				</div>
			{/if}
		</header>

		{#if banner}
			<div class={`banner ${banner.kind}`} aria-live="polite">
				{banner.message}
			</div>
		{/if}

		<div class="workspace-board">
			<div
				class={`dropzone ${dragActive ? 'drag-active' : ''} ${!auth ? 'dropzone-disabled' : ''}`}
			>
				<input
					class="hidden-input"
					type="file"
					bind:this={fileInput}
					accept=".csv,text/csv"
					onchange={handleFileChange}
					disabled={!auth}
				/>

				<button
					class="dropzone-surface"
					type="button"
					onclick={handleDropzoneActivate}
					ondragenter={handleDragEnter}
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
					ondrop={handleDrop}
					disabled={!auth}
					aria-disabled={!auth}
				>
					<div class="dropzone-icon">
						<Icon icon={uploadIcon} width="88" height="88" />
					</div>
					<p class="dropzone-copy">
						CSV 파일 드래그 또는 <strong>선택</strong>
					</p>
					<p class="dropzone-file">
						{selectedFileName ? `선택 파일: ${selectedFileName}` : '선택된 파일이 없습니다.'}
					</p>
					{#if !auth}
						<p class="dropzone-lock">Cafe24 연결 정보가 없습니다.</p>
					{/if}
				</button>

				<div class="dropzone-actions">
					{#if selectedFileName && auth}
						<p class={`apply-hint ${canApply ? 'ready' : ''}`} aria-live="polite">
							{#if phase === 'running'}
								Cafe24에 적용하고 있습니다. 완료 후 행별 결과를 확인할 수 있습니다.
							{:else if summary?.failure}
								실패한 행의 결과를 확인하고 CSV 또는 상품 상태를 수정한 뒤 다시 적용하세요.
							{:else if canApply}
								CSV 확인을 마쳤습니다. 아래 버튼을 누르면 Cafe24에 실제로 등록 또는 수정됩니다.
							{:else}
								CSV 오류를 수정한 뒤 Cafe24에 적용할 수 있습니다.
							{/if}
						</p>
					{/if}
					<button
						class="primary-button"
						type="button"
						onclick={handlers.onApply}
						disabled={!canApply || phase !== 'ready'}
					>
						{applyButtonLabel}
					</button>
				</div>
			</div>

			<div class="status-panel">
				<div class="panel-top">
					<button class="template-button" type="button" onclick={handlers.onDownload}>
						<Icon icon={downloadIcon} width="18" height="18" />
						<span>추가구성상품 설정용 CSV 양식 다운로드</span>
					</button>
					<p>전용 양식을 내려받아 정보 입력 후 업로드합니다.</p>
				</div>

				{#if progress}
					<div class="progress-card" aria-live="polite">
						<div class="progress-copy">
							<strong>{progress.label ?? '업로드를 처리하고 있습니다.'}</strong>
							<span>{progress.current} / {progress.total}</span>
						</div>
						<button class="secondary-button compact" type="button" onclick={handlers.onCancel}>
							중단
						</button>
					</div>
				{/if}

				{#if summary}
					<div class="summary-grid" aria-live="polite">
						<div>
							<span>전체</span>
							<strong>{summary.total}</strong>
						</div>
						<div>
							<span>등록</span>
							<strong>{summary.creates}</strong>
						</div>
						<div>
							<span>수정</span>
							<strong>{summary.updates}</strong>
						</div>
						<div>
							<span>실패</span>
							<strong>{summary.failure}</strong>
						</div>
					</div>
				{/if}

				<section class="status-section">
					<div class="section-head">
						<h2>진행중</h2>
					</div>

					{#if runningJobs.length === 0}
						<div class="empty-panel">진행중인 파일이 없습니다.</div>
					{:else}
						<div class="job-list">
							{#each runningJobs as job (job.id)}
								<article class="job-card">
									<div class="job-main">
										<div>
											<h3>{job.fileName}</h3>
											<p>{formatDate(job.startedAt)}</p>
										</div>
										<span class="job-badge running">
											<Icon icon={pendingIcon} width="16" height="16" />
											진행중
										</span>
									</div>
									{#if job.note}
										<p class="job-note">{job.note}</p>
									{/if}
									{#if job.results.length > 0}
										<div class="job-actions">
											<button
												class="secondary-button compact"
												type="button"
												onclick={() => toggleResults(job.id)}
												aria-expanded={expandedResultJobId === job.id}
												aria-controls={`job-results-${job.id}`}
											>
												{expandedResultJobId === job.id ? '결과 숨기기' : '결과 보기'}
											</button>
											<button
												class="secondary-button compact"
												type="button"
												onclick={() => handlers.onDownloadResults(job.id)}
											>
												<Icon icon={downloadIcon} width="16" height="16" />
												결과 CSV 다운로드
											</button>
										</div>

										{#if expandedResultJobId === job.id}
											<div class="result-table-wrap" id={`job-results-${job.id}`}>
												<table class="result-table">
													<thead>
														<tr>
															<th scope="col">행</th>
															<th scope="col">기준상품</th>
															<th scope="col">요청 추가상품</th>
															<th scope="col">Cafe24 응답 추가상품</th>
															<th scope="col">처리</th>
															<th scope="col">결과</th>
															<th scope="col">Cafe24 응답 메시지</th>
														</tr>
													</thead>
													<tbody>
														{#each job.results as result (result.row)}
															<tr>
																<td>{result.row}</td>
																<td>{result.productNo}</td>
																<td>{formatProductNumbers(result.requestedAdditionalProducts)}</td>
																<td>{formatProductNumbers(result.returnedAdditionalProducts)}</td>
																<td>{result.method ?? '-'}</td>
																<td>
																	<span class={`result-badge ${result.ok ? 'success' : 'failure'}`}>
																		{result.ok ? '성공' : '실패'}
																	</span>
																	<span class="http-status">
																		{formatResponseSummary(result.httpStatus, result.totalCount)}
																	</span>
																</td>
																<td class="result-message">{result.message}</td>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				</section>

				<section class="status-section completed-section">
					<div class="section-head">
						<h2>진행완료</h2>
						{#if finishedJobs.length > 0 && runningJobs.length === 0}
							<button
								class="icon-button history-clear-button"
								type="button"
								onclick={handlers.onClearCompletedJobs}
								aria-label="완료 기록 전체 삭제"
								title="완료 기록 전체 삭제"
							>
								<Icon icon={deleteSweepIcon} width="18" height="18" />
							</button>
						{/if}
					</div>

					{#if finishedJobs.length === 0}
						<div class="empty-panel">완료된 파일이 없습니다.</div>
					{:else}
						<div class="job-list finished-job-list">
							{#each finishedJobs as job (job.id)}
								<article class="job-card">
									<div class="job-main">
										<div>
											<h3>{job.fileName}</h3>
											<p>
												{formatDate(job.completedAt ?? job.startedAt)} · 성공 {job.successCount} · 실패
												{job.failureCount}
											</p>
										</div>
										<div class="job-status">
											<span
												class={`job-badge ${job.status === 'completed' ? 'completed' : 'cancelled'}`}
											>
												<Icon
													icon={job.status === 'completed' ? successIcon : warningIcon}
													width="16"
													height="16"
												/>
												{job.status === 'completed' ? '완료' : '취소'}
											</span>
											<button
												class="icon-button record-delete-button"
												type="button"
												onclick={() => handlers.onDeleteCompletedJob(job.id)}
												aria-label={`${job.fileName} 완료 기록 삭제`}
												title="완료 기록 삭제"
											>
												<Icon icon={deleteIcon} width="17" height="17" />
											</button>
										</div>
									</div>
									{#if job.note}
										<p class="job-note">{job.note}</p>
									{/if}
									{#if job.results.length > 0}
										<div class="job-actions">
											<button
												class="secondary-button compact"
												type="button"
												onclick={() => toggleResults(job.id)}
												aria-expanded={expandedResultJobId === job.id}
												aria-controls={`job-results-${job.id}`}
											>
												{expandedResultJobId === job.id ? '결과 숨기기' : '결과 보기'}
											</button>
											<button
												class="secondary-button compact"
												type="button"
												onclick={() => handlers.onDownloadResults(job.id)}
											>
												<Icon icon={downloadIcon} width="16" height="16" />
												결과 CSV 다운로드
											</button>
										</div>

										{#if expandedResultJobId === job.id}
											<div class="result-table-wrap" id={`job-results-${job.id}`}>
												<table class="result-table">
													<thead>
														<tr>
															<th scope="col">행</th>
															<th scope="col">기준상품</th>
															<th scope="col">요청 추가상품</th>
															<th scope="col">Cafe24 응답 추가상품</th>
															<th scope="col">처리</th>
															<th scope="col">결과</th>
															<th scope="col">Cafe24 응답 메시지</th>
														</tr>
													</thead>
													<tbody>
														{#each job.results as result (result.row)}
															<tr>
																<td>{result.row}</td>
																<td>{result.productNo}</td>
																<td>{formatProductNumbers(result.requestedAdditionalProducts)}</td>
																<td>{formatProductNumbers(result.returnedAdditionalProducts)}</td>
																<td>{result.method ?? '-'}</td>
																<td>
																	<span class={`result-badge ${result.ok ? 'success' : 'failure'}`}>
																		{result.ok ? '성공' : '실패'}
																	</span>
																	<span class="http-status">
																		{formatResponseSummary(result.httpStatus, result.totalCount)}
																	</span>
																</td>
																<td class="result-message">{result.message}</td>
															</tr>
														{/each}
													</tbody>
												</table>
											</div>
										{/if}
									{/if}
								</article>
							{/each}
						</div>
					{/if}
				</section>

				{#if issues.length > 0}
					<section class="issue-section" aria-live="polite">
						<div class="section-head">
							<h2>검토 필요</h2>
						</div>
						<ul>
							{#each issues as issue, index (issue.row + ':' + index)}
								<li>
									<span>{issue.row}행</span>
									<p>{issue.message}</p>
								</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.workspace-shell {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 10px 10px 18px;
	}

	.workspace-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	h1,
	h2,
	h3,
	p {
		margin: 0;
	}

	h1 {
		font-size: 21px;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #2f3747;
	}

	.auth-pill,
	.banner,
	.workspace-board,
	.dropzone,
	.status-panel,
	.job-card,
	.summary-grid div,
	.progress-card,
	.empty-panel,
	.issue-section,
	.primary-button,
	.secondary-button,
	.template-button {
		border-radius: 6px;
	}

	.auth-pill {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 10px;
		padding: 8px 12px;
		font-size: 12px;
		font-weight: 600;
		color: #5e6880;
		background: #fff;
		border: 1px solid #e2e8f0;
		border-radius: 999px;
	}

	.banner {
		padding: 14px 18px;
		font-size: 14px;
		font-weight: 600;
		border: 1px solid transparent;
	}

	.banner.error {
		color: #8d3144;
		background: rgba(255, 236, 240, 0.94);
		border-color: rgba(226, 163, 178, 0.8);
	}

	.banner.success {
		color: #1c6e52;
		background: rgba(233, 250, 241, 0.95);
		border-color: rgba(163, 218, 192, 0.8);
	}

	.banner.info {
		color: #4a6587;
		background: rgba(236, 244, 255, 0.95);
		border-color: rgba(181, 203, 236, 0.86);
	}

	.primary-button:focus-visible,
	.secondary-button:focus-visible,
	.template-button:focus-visible,
	.dropzone-surface:focus-visible {
		box-shadow: 0 0 0 3px rgba(113, 151, 247, 0.2);
		border-color: #7a97e9;
	}

	.primary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 0;
		padding: 16px 24px;
		font-size: 15px;
		font-weight: 700;
		color: #fff;
		background: #7d99ef;
		box-shadow: none;
		border-radius: 999px;
	}

	.primary-button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
		box-shadow: none;
	}

	.access-state {
		display: grid;
		min-height: calc(100vh - 28px);
		place-items: center;
		padding: 24px;
	}

	.access-message {
		display: flex;
		width: min(520px, 100%);
		flex-direction: column;
		gap: 10px;
		padding: 36px 28px;
		border: 1px solid #e1e5ec;
		border-radius: 8px;
		background: #fff;
		text-align: center;
	}

	.access-message h1 {
		font-size: 23px;
		letter-spacing: -0.03em;
	}

	.access-message p {
		font-size: 15px;
		line-height: 1.65;
		color: #68728a;
	}

	.workspace-board {
		display: grid;
		grid-template-columns: minmax(320px, 33%) minmax(0, 1fr);
		gap: 28px;
		padding: 18px;
		background: #fff;
		border: 0;
		box-shadow: none;
		border-radius: 4px;
	}

	.dropzone {
		display: flex;
		flex-direction: column;
		gap: 20px;
		min-height: 500px;
		padding: 20px;
		border: 1.5px dashed #8facff;
		background: #eff4ff;
		border-radius: 0;
	}

	.dropzone-disabled {
		opacity: 0.96;
	}

	.dropzone.drag-active {
		border-color: #6f91f2;
		background: #e8f0ff;
	}

	.dropzone-surface {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 18px;
		width: 100%;
		border: 0;
		padding: 20px;
		background: transparent;
		color: inherit;
		text-align: center;
	}

	.dropzone-surface:disabled {
		cursor: default;
	}

	.hidden-input {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		border: 0;
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
	}

	.dropzone-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 144px;
		height: 144px;
		border-radius: 999px;
		background: #fff;
		color: #5c84ef;
		box-shadow: none;
	}

	.dropzone-copy {
		font-size: 16px;
		font-weight: 500;
		color: #8891a7;
	}

	.dropzone-copy strong {
		color: #4f76df;
	}

	.dropzone-file {
		font-size: 14px;
		line-height: 1.6;
		color: #5f6880;
		word-break: break-all;
	}

	.dropzone-lock {
		font-size: 13px;
		font-weight: 600;
		color: #607089;
	}

	.dropzone-actions {
		display: flex;
		flex-wrap: wrap;
		flex-direction: column;
		gap: 12px;
		align-items: center;
		justify-content: center;
	}

	.apply-hint {
		max-width: 280px;
		font-size: 13px;
		line-height: 1.55;
		color: #69748a;
		text-align: center;
	}

	.apply-hint.ready {
		color: #315f4f;
	}

	.primary-button {
		min-width: 176px;
	}

	.secondary-button,
	.template-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 1px solid #d7dce5;
		padding: 15px 22px;
		background: #fff;
		font-size: 14px;
		font-weight: 700;
		color: #556077;
		border-radius: 999px;
	}

	.secondary-button.compact {
		padding-inline: 18px;
	}

	.status-panel {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.panel-top {
		display: flex;
		flex-direction: column;
		gap: 10px;
		align-items: flex-start;
	}

	.panel-top p {
		font-size: 15px;
		line-height: 1.7;
		color: #6c758a;
	}

	.progress-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 18px;
		background: #f8fafc;
		border: 1px solid #e5e7eb;
	}

	.progress-copy {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.progress-copy strong {
		font-size: 15px;
		color: #33415c;
	}

	.progress-copy span {
		font-size: 13px;
		color: #69809f;
	}

	.summary-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}

	.summary-grid div {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px 18px;
		background: #f8fafc;
		border: 1px solid #e5e7eb;
	}

	.summary-grid span {
		font-size: 12px;
		font-weight: 700;
		color: #8090ad;
	}

	.summary-grid strong {
		font-size: 26px;
		font-weight: 700;
		color: #2e3748;
	}

	.status-section,
	.issue-section {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.section-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.section-head::after {
		content: '';
		order: 1;
		flex: 1;
		height: 1px;
		background: rgba(225, 228, 236, 0.98);
	}

	.section-head h2 {
		font-size: 17px;
		font-weight: 700;
		color: #2f3749;
	}

	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 0;
		padding: 0;
		color: #a14a5c;
		background: transparent;
		border-radius: 6px;
	}

	.history-clear-button {
		order: 2;
		white-space: nowrap;
	}

	.icon-button:hover {
		background: rgba(255, 238, 242, 0.9);
	}

	.icon-button:focus-visible {
		outline: 2px solid rgba(159, 70, 89, 0.35);
		outline-offset: 2px;
		border-radius: 4px;
	}

	.empty-panel {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 106px;
		border: 0;
		background: transparent;
		font-size: 14px;
		font-weight: 500;
		color: #3d475c;
		border-radius: 0;
	}

	.job-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.job-card {
		padding: 18px;
		background: #fff;
		border: 1px solid #e5e7eb;
		box-shadow: none;
	}

	.job-main {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.job-main h3 {
		font-size: 15px;
		font-weight: 700;
		color: #2f3749;
	}

	.job-main p,
	.job-note {
		font-size: 13px;
		line-height: 1.6;
		color: #70798e;
	}

	.job-note {
		margin-top: 10px;
	}

	.job-status {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}

	@media (min-width: 981px) {
		.workspace-board {
			height: min(1020px, calc(100vh - 122px));
			min-height: 620px;
			align-items: stretch;
			overflow: hidden;
		}

		.dropzone {
			height: 100%;
			min-height: 0;
		}

		.status-panel {
			min-height: 0;
			overflow: hidden;
		}

		.completed-section {
			flex: 1;
			min-height: 0;
		}

		.finished-job-list {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding-right: 6px;
			overscroll-behavior: contain;
			scrollbar-gutter: stable;
		}
	}

	.job-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 14px;
	}

	.result-table-wrap {
		margin-top: 14px;
		overflow-x: auto;
		border: 1px solid #e2e7ef;
		border-radius: 6px;
		background: #fff;
	}

	.result-table {
		width: 100%;
		min-width: 760px;
		border-collapse: collapse;
		font-size: 13px;
		color: #49546a;
	}

	.result-table th,
	.result-table td {
		padding: 12px 14px;
		border-bottom: 1px solid #edf0f4;
		text-align: left;
		vertical-align: top;
	}

	.result-table th {
		font-size: 12px;
		font-weight: 700;
		white-space: nowrap;
		color: #66728a;
		background: #f8fafc;
	}

	.result-table tbody tr:last-child td {
		border-bottom: 0;
	}

	.result-table td:nth-child(1),
	.result-table td:nth-child(2),
	.result-table td:nth-child(5) {
		white-space: nowrap;
	}

	.result-badge {
		display: inline-flex;
		align-items: center;
		padding: 4px 8px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
	}

	.result-badge.success {
		color: #1d7256;
		background: rgba(236, 250, 243, 0.98);
	}

	.result-badge.failure {
		color: #9e3b50;
		background: rgba(255, 238, 242, 0.98);
	}

	.http-status {
		display: block;
		margin-top: 5px;
		font-size: 12px;
		color: #768198;
		white-space: nowrap;
	}

	.result-message {
		min-width: 240px;
		line-height: 1.55;
		word-break: break-word;
	}

	.job-badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: 999px;
		font-size: 12px;
		font-weight: 700;
	}

	.job-badge.running {
		color: #4c67a6;
		background: rgba(237, 243, 255, 0.98);
	}

	.job-badge.completed {
		color: #1d7256;
		background: rgba(236, 250, 243, 0.98);
	}

	.job-badge.cancelled {
		color: #8a4f37;
		background: rgba(255, 244, 235, 0.98);
	}

	.issue-section ul {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 0;
		margin: 0;
		list-style: none;
	}

	.issue-section li {
		display: grid;
		grid-template-columns: 72px 1fr;
		gap: 14px;
		padding: 14px 16px;
		border: 1px solid rgba(229, 213, 188, 0.94);
		background: rgba(255, 250, 244, 0.96);
		border-radius: 18px;
	}

	.issue-section span {
		font-size: 12px;
		font-weight: 700;
		color: #93643c;
	}

	.issue-section p {
		font-size: 14px;
		line-height: 1.6;
		color: #644a34;
	}

	@media (max-width: 980px) {
		.workspace-board {
			grid-template-columns: 1fr;
			padding-inline: 0;
		}

		.dropzone {
			min-height: 480px;
		}
	}

	@media (max-width: 720px) {
		.workspace-shell {
			padding-inline: 10px;
		}

		.workspace-header {
			flex-direction: column;
			align-items: flex-start;
		}

		h1 {
			font-size: 22px;
		}

		.workspace-board {
			padding: 18px;
		}

		.access-state {
			min-height: calc(100vh - 20px);
			padding: 16px;
		}

		.access-message {
			padding: 30px 20px;
		}

		.dropzone {
			min-height: 440px;
			padding: 18px;
		}

		.dropzone-icon {
			width: 144px;
			height: 144px;
		}

		.summary-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.progress-card,
		.job-main,
		.issue-section li {
			flex-direction: column;
			align-items: flex-start;
		}

		.issue-section li {
			grid-template-columns: 1fr;
		}

		.job-actions {
			align-items: stretch;
		}

		.job-actions .secondary-button {
			flex: 1 1 160px;
		}

		.job-status {
			align-items: flex-start;
		}
	}
</style>

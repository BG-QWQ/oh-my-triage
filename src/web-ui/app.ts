/**
 * oh-my-triage Setup Wizard — client-side application logic.
 *
 * Manages the 11-step setup flow: welcome, scanner selection, per-scanner
 * configuration, security settings, MCP config generation, and summary.
 * All API calls go through setup-api.ts with Zod-validated responses.
 */

import {
  type ScannerType,
  type SetupStatus,
  type TestConnectionResponse,
  type McpClientDetection,
  type WriteConfigResponse,
  type TokenStorage,
  type SaveSetupSource,
  type RepositoryOption,
  ApiError,
  getSetupStatus,
  testConnection,
  detectMcpClients,
  writeConfig,
  saveSetup,
  startServer,
  getServerCommand,
} from './setup-api.js';

// ── Wizard state ──────────────────────────────────────────────────────

/** All wizard step IDs in order */
const STEPS = [
  'welcome',
  'scanner-select',
  'sarif-config',
  'github-config',
  'sonarcloud-config',
  'socket-config',
  'snyk-config',
  'semgrep-config',
  'security-settings',
  'mcp-config',
  'summary',
] as const;

type StepId = (typeof STEPS)[number];

export type SemgrepIssueTypeSelection = 'sast' | 'sca' | 'both';

/** Semgrep setup values collected by the browser wizard. */
export type SemgrepSetupConfig = {
  readonly token?: string;
  readonly deployment?: string;
  readonly issueType: SemgrepIssueTypeSelection;
};

/** Minimal native input contract used by reusable card-selection binders. */
export type SelectableInput = Pick<HTMLInputElement, 'checked' | 'value' | 'addEventListener'>;

/** Minimal card contract for toggling design-system selection state. */
export type SelectableCard = {
  readonly classList: Pick<DOMTokenList, 'toggle'>;
};

/** Minimal radio-card contract for native-input synchronization. */
export type RadioOptionElement = SelectableCard & {
  readonly querySelector: (selector: string) => SelectableInput | null;
};

/** Minimal radio-card group contract used by dynamic option binders. */
export type RadioOptionGroup = {
  readonly querySelectorAll: (selector: string) => ArrayLike<RadioOptionElement>;
  readonly querySelector: (selector: string) => SelectableInput | null;
};

function radioOptionElementsFromGroup(group: RadioOptionGroup): RadioOptionElement[] {
  return Array.from(group.querySelectorAll('.radio-option'));
}

function radioOptionGroup(element: Element): RadioOptionGroup {
  return {
    querySelectorAll: (selector: string) => radioOptionElements(element.querySelectorAll<HTMLElement>(selector)),
    querySelector: (selector: string) => element.querySelector<HTMLInputElement>(selector),
  };
}

function radioOptionElements(options: ArrayLike<HTMLElement>): RadioOptionElement[] {
  return Array.from(options).map((option) => ({
    classList: option.classList,
    querySelector: (selector: string) => option.querySelector<HTMLInputElement>(selector),
  }));
}

const SCANNER_CONFIG_STEPS: Array<{ scanner: ScannerType; step: StepId }> = [
  { scanner: 'sarif', step: 'sarif-config' },
  { scanner: 'github', step: 'github-config' },
  { scanner: 'sonarcloud', step: 'sonarcloud-config' },
  { scanner: 'socket', step: 'socket-config' },
  { scanner: 'snyk', step: 'snyk-config' },
  { scanner: 'semgrep', step: 'semgrep-config' },
];

/** Wizard state tracked across steps */
interface WizardState {
  currentStep: StepId;
  selectedScanners: Set<ScannerType>;
  sarifFilePath: string;
  githubToken: string;
  githubOrg: string;
  githubRepositories: RepositoryOption[];
  githubSelectedRepositories: Map<string, RepositoryOption>;
  sonarcloudToken: string;
  sonarcloudOrganization: string;
  sonarcloudProject: string;
  socketToken: string;
  socketOrganization: string;
  snykToken: string;
  snykOrganization: string;
  semgrepToken: string;
  semgrepDeployment: string;
  semgrepIssueType: SemgrepIssueTypeSelection;
  tokenStorage: TokenStorage;
  connectionResults: Map<ScannerType, TestConnectionResponse>;
  mcpClients: McpClientDetection | null;
  configResults: Map<string, WriteConfigResponse>;
  setupStatus: SetupStatus | null;
  setupSaved: boolean;
  serverCommand: { command: string; args: string[] } | null;
}

const state: WizardState = {
  currentStep: 'welcome',
  selectedScanners: new Set(),
  sarifFilePath: '',
  githubToken: '',
  githubOrg: '',
  githubRepositories: [],
  githubSelectedRepositories: new Map(),
  sonarcloudToken: '',
  sonarcloudOrganization: '',
  sonarcloudProject: '',
  socketToken: '',
  socketOrganization: '',
  snykToken: '',
  snykOrganization: '',
  semgrepToken: '',
  semgrepDeployment: '',
  semgrepIssueType: 'both',
  tokenStorage: 'keychain',
  connectionResults: new Map(),
  mcpClients: null,
  configResults: new Map(),
  setupStatus: null,
  setupSaved: false,
  serverCommand: null,
};

// ── DOM helpers ───────────────────────────────────────────────────────

/** Shorthand querySelector that throws if element not found */
function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

/** Shorthand querySelectorAll */
function $$<T extends HTMLElement = HTMLElement>(selector: string): NodeListOf<T> {
  return document.querySelectorAll<T>(selector);
}

/** Show a status message in a container */
function showStatus(container: HTMLElement, type: 'success' | 'error' | 'warning' | 'info', message: string): void {
  // Remove existing status messages in this container
  container.querySelectorAll('.status-message').forEach((el) => el.remove());

  const icons: Record<string, string> = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ',
  };

  const div = document.createElement('div');
  div.className = `status-message ${type}`;
  div.innerHTML = `<span class="status-icon">${icons[type]}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(div);
}

/** Escape HTML to prevent XSS */
function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

type ConfigInvalidResponse = {
  error: string;
  code: string;
  next_steps: string[];
};

/** Extract a structured config-invalid error from an ApiError response. */
function parseConfigInvalidError(err: unknown): ConfigInvalidResponse | undefined {
  if (!(err instanceof ApiError) || err.status !== 500) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(err.body) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'code' in parsed &&
      parsed.code === 'CONFIG_INVALID' &&
      'error' in parsed &&
      typeof parsed.error === 'string' &&
      'next_steps' in parsed &&
      Array.isArray(parsed.next_steps)
    ) {
      return parsed as ConfigInvalidResponse;
    }
  } catch {
    // Ignore malformed JSON bodies.
  }

  return undefined;
}

/** Create a loading indicator */
function showLoading(container: HTMLElement, message: string): void {
  container.querySelectorAll('.status-message, .loading-overlay').forEach((el) => el.remove());
  const div = document.createElement('div');
  div.className = 'loading-overlay';
  div.innerHTML = `<span class="spinner"></span><span>${escapeHtml(message)}</span>`;
  container.appendChild(div);
}

/** Remove loading indicators */
function removeLoading(container: HTMLElement): void {
  container.querySelectorAll('.loading-overlay').forEach((el) => el.remove());
}

/** Bind a button to toggle the visibility of a password input. */
function bindPasswordVisibilityToggle(tokenInput: HTMLInputElement, toggleBtn: HTMLButtonElement): void {
  toggleBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
  });
}

/** Bind an input so its trimmed value is written to state on every input event. */
function bindTrimmedInput(input: HTMLInputElement, applyValue: (value: string) => void): void {
  input.addEventListener('input', () => {
    applyValue(input.value.trim());
  });
}

/** Status message produced for a failed connection test. */
export type ConnectionStatusMessage = {
  type: 'error' | 'warning';
  message: string;
};

/** Build the error and optional warning messages for an invalid connection result. */
export function buildInvalidConnectionMessages(
  result: TestConnectionResponse,
  fallbackMessage: string
): ConnectionStatusMessage[] {
  if (result.valid) {
    return [];
  }

  const messages: ConnectionStatusMessage[] = [
    { type: 'error', message: result.reason ?? fallbackMessage },
  ];
  if (result.suggestion) {
    messages.push({ type: 'warning', message: result.suggestion });
  }
  return messages;
}

/** Format a connection-test error consistently across scanner handlers. */
export function formatConnectionTestError(err: unknown): string {
  return `Connection test failed: ${err instanceof Error ? err.message : 'Unknown error'}`;
}

/** Options that parameterize the shared scanner connection-test flow. */
type ConnectionTestOptions = {
  scanner: ScannerType;
  validate: () => string | undefined;
  loadingMessage: string;
  buildConfig: () => Record<string, unknown>;
  invalidFallbackMessage: string;
  formatSuccess: (result: TestConnectionResponse) => string;
  onValid?: (result: TestConnectionResponse) => void;
};

/** Run a scanner connection test and update the wizard state and UI. */
async function runScannerConnectionTest(
  testBtn: HTMLButtonElement,
  statusContainer: HTMLElement,
  options: ConnectionTestOptions
): Promise<void> {
  const missing = options.validate();
  if (missing) {
    showStatus(statusContainer, 'error', missing);
    return;
  }

  showLoading(statusContainer, options.loadingMessage);
  testBtn.disabled = true;

  try {
    const result = await testConnection(options.scanner, options.buildConfig());
    removeLoading(statusContainer);

    if (result.valid) {
      state.connectionResults.set(options.scanner, result);
      options.onValid?.(result);
      showStatus(statusContainer, 'success', options.formatSuccess(result));
    } else {
      for (const message of buildInvalidConnectionMessages(result, options.invalidFallbackMessage)) {
        showStatus(statusContainer, message.type, message.message);
      }
    }
  } catch (err) {
    removeLoading(statusContainer);
    showStatus(statusContainer, 'error', formatConnectionTestError(err));
  } finally {
    testBtn.disabled = false;
  }
}

// ── Step navigation ──────────────────────────────────────────────────

/** Determine which step comes next based on selected scanners */
function getNextStep(current: StepId): StepId | null {
  return getAdjacentStep(current, state.selectedScanners, 1);
}

/** Determine which step comes before */
function getPrevStep(current: StepId): StepId | null {
  return getAdjacentStep(current, state.selectedScanners, -1);
}

/** Determine the adjacent wizard step after filtering unselected scanner config panels. */
function getAdjacentStep(current: StepId, selectedScanners: ReadonlySet<ScannerType>, direction: 1 | -1): StepId | null {
  const visibleSteps = STEPS.filter((step) => isStepVisible(step, selectedScanners));
  const currentIndex = visibleSteps.indexOf(current);
  if (currentIndex === -1) {
    return null;
  }
  return visibleSteps[currentIndex + direction] ?? null;
}

/** Return whether a setup step should be reachable for selected scanners. */
function isStepVisible(step: StepId, selectedScanners: ReadonlySet<ScannerType>): boolean {
  const scannerConfig = SCANNER_CONFIG_STEPS.find((entry) => entry.step === step);
  return scannerConfig ? selectedScanners.has(scannerConfig.scanner) : true;
}

/** Navigate to a specific step */
function goToStep(stepId: StepId): void {
  state.currentStep = stepId;

  // Update panels
  $$('.step-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.step === stepId);
  });

  // Update nav
  const currentIdx = STEPS.indexOf(stepId);
  $$('.step-nav-item').forEach((item, idx) => {
    item.classList.remove('active', 'completed');
    if (idx < currentIdx) item.classList.add('completed');
    if (idx === currentIdx) item.classList.add('active');
  });

  // Update nav buttons
  updateNavButtons();

  // Run step-specific initialization
  if (stepId === 'mcp-config') initMcpConfigStep();
  if (stepId === 'summary') initSummaryStep();
}

/** Update next/prev button states */
function updateNavButtons(): void {
  const prevBtn = $<HTMLButtonElement>('#btn-prev');
  const nextBtn = $<HTMLButtonElement>('#btn-next');

  prevBtn.disabled = getPrevStep(state.currentStep) === null;

  const nextStep = getNextStep(state.currentStep);
  if (state.currentStep === 'summary') {
    nextBtn.textContent = 'Start Server';
    nextBtn.disabled = false;
  } else if (nextStep === null) {
    nextBtn.disabled = true;
  } else {
    nextBtn.textContent = 'Continue';
    nextBtn.disabled = false;
  }
}

// ── Step: Welcome ─────────────────────────────────────────────────────

function initWelcomeStep(): void {
  bindWelcomeStartButton($<HTMLButtonElement>('#btn-get-started'), goToStep);

  // Load current setup status
  const statusContainer = $<HTMLElement>('#welcome-status');
  showLoading(statusContainer, 'Checking setup status...');

  getSetupStatus()
    .then((status) => {
      state.setupStatus = status;
      removeLoading(statusContainer);
      if (status.initialized) {
        showStatus(statusContainer, 'info', `Setup already started. ${status.configured_scanners.length} scanner(s) configured, ${status.total_findings} findings indexed.`);
      } else {
        showStatus(statusContainer, 'info', 'No existing configuration found. Let\'s get started!');
      }
    })
    .catch((err: unknown) => {
      removeLoading(statusContainer);
      const configError = parseConfigInvalidError(err);
      if (configError) {
        const steps = configError.next_steps.length > 0
          ? ` ${configError.next_steps.join(' ')}`
          : '';
        showStatus(statusContainer, 'error', `${configError.error}${steps}`);
        return;
      }
      showStatus(statusContainer, 'warning', 'Could not reach the setup server. You can still configure settings locally.');
    });
}

/** Bind the welcome call-to-action to the first configuration step.
 *
 * The landing CTA is the beginner path into setup, while the footer Continue
 * button remains available for keyboard users who expect global navigation.
 */
export function bindWelcomeStartButton(button: EventTarget, navigate: (step: 'scanner-select') => void): void {
  button.addEventListener('click', () => {
    navigate('scanner-select');
  });
}

function scannerTypeFromValue(value: string): ScannerType {
  switch (value) {
    case 'sarif':
    case 'github':
    case 'sonarcloud':
    case 'socket':
    case 'snyk':
    case 'semgrep':
      return value;
  }

  throw new Error(`Unknown scanner type: ${value}`);
}

function semgrepIssueTypeFromValue(value: string): SemgrepIssueTypeSelection {
  switch (value) {
    case 'sast':
    case 'sca':
    case 'both':
      return value;
  }

  throw new Error(`Unknown Semgrep issue type: ${value}`);
}

function tokenStorageFromValue(value: string): TokenStorage {
  switch (value) {
    case 'keychain':
    case 'env':
    case 'encrypted-file':
      return value;
  }

  throw new Error(`Unknown token storage: ${value}`);
}

/** Synchronize a selectable card from its native checkbox state. */
export function syncScannerCardSelection(input: SelectableInput, card: SelectableCard, selectedScanners: Set<ScannerType>): void {
  const scannerType = scannerTypeFromValue(input.value);
  card.classList.toggle('selected', input.checked);

  if (input.checked) {
    selectedScanners.add(scannerType);
  } else {
    selectedScanners.delete(scannerType);
  }
}

/** Bind a selectable scanner card through the native checkbox change event. */
export function bindScannerCardSelection(input: SelectableInput, card: SelectableCard, selectedScanners: Set<ScannerType>): void {
  input.checked = selectedScanners.has(scannerTypeFromValue(input.value));
  syncScannerCardSelection(input, card, selectedScanners);

  input.addEventListener('change', () => {
    syncScannerCardSelection(input, card, selectedScanners);
  });
}

/** Synchronize a radio-card group from the checked native radio input. */
export function syncRadioOptionSelection(options: readonly RadioOptionElement[]): SelectableInput | null {
  let selectedInput: SelectableInput | null = null;

  for (const option of options) {
    const input = option.querySelector('input[type="radio"]');
    const selected = Boolean(input?.checked);
    option.classList.toggle('selected', selected);
    if (input?.checked) {
      selectedInput = input;
    }
  }

  return selectedInput;
}

/** Bind radio-card options through native radio change events. */
export function bindRadioOptionSelection(
  options: readonly RadioOptionElement[],
  isSelected: (input: SelectableInput) => boolean,
  onSelection: (input: SelectableInput) => void
): void {
  for (const option of options) {
    const input = option.querySelector('input[type="radio"]');
    if (!input) continue;

    input.checked = isSelected(input);
    input.addEventListener('change', () => {
      if (!input.checked) return;
      syncRadioOptionSelection(options);
      onSelection(input);
    });
  }

  syncRadioOptionSelection(options);
}

// ── Step: Scanner selection ──────────────────────────────────────────

function initScannerSelectStep(): void {
  const cards = $$('.checkbox-card');
  cards.forEach((card) => {
    const input = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) return;

    bindScannerCardSelection(input, card, state.selectedScanners);
  });
}

// ── Step: SARIF config ───────────────────────────────────────────────

function initSarifConfigStep(): void {
  const input = $<HTMLInputElement>('#sarif-file-path');
  input.value = state.sarifFilePath;

  input.addEventListener('input', () => {
    state.sarifFilePath = input.value.trim();
  });
}

// ── Step: GitHub config ──────────────────────────────────────────────

function initGithubConfigStep(): void {
  const tokenInput = $<HTMLInputElement>('#github-token');
  const orgSelect = $<HTMLSelectElement>('#github-org');
  const repoList = $<HTMLElement>('#github-repo-list');
  const statusContainer = $<HTMLElement>('#github-status');

  tokenInput.value = state.githubToken;

  bindPasswordVisibilityToggle(tokenInput, $<HTMLButtonElement>('#toggle-github-token'));

  bindTrimmedInput(tokenInput, (value) => {
    state.githubToken = value;
    state.githubOrg = '';
    state.githubRepositories = [];
    state.githubSelectedRepositories.clear();
    renderGithubRepositoryOptions(orgSelect, repoList);
  });

  // Test connection
  const testBtn = $<HTMLButtonElement>('#test-github-connection');
  testBtn.addEventListener('click', () => {
    void handleGithubConnectionTest(testBtn, statusContainer);
  });

  orgSelect.addEventListener('change', () => {
    state.githubOrg = orgSelect.value;
    renderGithubRepositoryOptions(orgSelect, repoList);
  });
}

/** Test GitHub connectivity and update the wizard state. */
async function handleGithubConnectionTest(testBtn: HTMLButtonElement, statusContainer: HTMLElement): Promise<void> {
  await runScannerConnectionTest(testBtn, statusContainer, {
    scanner: 'github',
    validate: () =>
      state.githubToken ? undefined : 'Please enter a GitHub token first.',
    loadingMessage: 'Testing GitHub connection...',
    buildConfig: () => ({ token: state.githubToken }),
    invalidFallbackMessage: 'Connection failed. Check your token and permissions.',
    formatSuccess: (result) =>
      `Connected! Found ${result.projects_found ?? 0} accessible repositories.`,
    onValid: (result) => {
      state.githubRepositories = result.repositories ?? [];
      renderGithubRepositoryOptions(
        $<HTMLSelectElement>('#github-org'),
        $<HTMLElement>('#github-repo-list')
      );
    },
  });
}

/** Populate GitHub owner and repository selectors from discovered repositories. */
function renderGithubRepositoryOptions(orgSelect: HTMLSelectElement, repoList: HTMLElement): void {
  const owners = [...new Set(state.githubRepositories.map((repository) => repository.owner))].sort((a, b) => a.localeCompare(b));
  orgSelect.innerHTML = '<option value="">Select an owner</option>';
  for (const owner of owners) {
    orgSelect.appendChild(selectOption(owner, owner, owner === state.githubOrg));
  }

  const repositoriesForOwner = state.githubRepositories
    .filter((repository) => repository.owner === state.githubOrg)
    .sort((a, b) => a.name.localeCompare(b.name));
  repoList.innerHTML = '';
  if (!state.githubOrg) {
    repoList.appendChild(hint('Select an owner first.'));
    updateGithubRepositoryCount();
    return;
  }

  if (repositoriesForOwner.length === 0) {
    repoList.appendChild(hint('No repositories found for this owner.'));
    updateGithubRepositoryCount();
    return;
  }

  for (const repository of repositoriesForOwner) {
    repoList.appendChild(repositoryCheckbox(repository));
  }

  updateGithubRepositoryCount();
}

function selectOption(value: string, label: string, selected: boolean): HTMLOptionElement {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  option.selected = selected;
  return option;
}

function repositoryCheckbox(repository: RepositoryOption): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'multi-select-option';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.value = repositoryKey(repository);
  checkbox.checked = state.githubSelectedRepositories.has(repositoryKey(repository));
  checkbox.addEventListener('change', () => {
    const key = repositoryKey(repository);
    if (checkbox.checked) {
      state.githubSelectedRepositories.set(key, repository);
    } else {
      state.githubSelectedRepositories.delete(key);
    }
    updateGithubRepositoryCount();
  });

  const text = document.createElement('span');
  text.className = 'multi-select-option-text';
  text.textContent = `${repository.name}${repository.private ? ' (private)' : ''}${repository.archived ? ' (archived)' : ''}`;

  label.append(checkbox, text);
  return label;
}

function hint(message: string): HTMLParagraphElement {
  const paragraph = document.createElement('p');
  paragraph.className = 'form-hint';
  paragraph.textContent = message;
  return paragraph;
}

function updateGithubRepositoryCount(): void {
  const count = state.githubSelectedRepositories.size;
  $<HTMLElement>('#github-repo-count').textContent = `${count} ${count === 1 ? 'repository' : 'repositories'} selected.`;
}

function repositoryKey(repository: Pick<RepositoryOption, 'owner' | 'name'>): string {
  return `${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
}

function selectedGithubRepositories(): RepositoryOption[] {
  return [...state.githubSelectedRepositories.values()].sort((a, b) => a.full_name.localeCompare(b.full_name));
}

// ── Step: SonarCloud config ──────────────────────────────────────────

function initSonarcloudConfigStep(): void {
  const tokenInput = $<HTMLInputElement>('#sonarcloud-token');
  const organizationInput = $<HTMLInputElement>('#sonarcloud-organization');
  const projectSelect = $<HTMLSelectElement>('#sonarcloud-project');
  const statusContainer = $<HTMLElement>('#sonarcloud-status');

  tokenInput.value = state.sonarcloudToken;
  organizationInput.value = state.sonarcloudOrganization;

  bindPasswordVisibilityToggle(tokenInput, $<HTMLButtonElement>('#toggle-sonarcloud-token'));
  bindTrimmedInput(tokenInput, (value) => { state.sonarcloudToken = value; });
  bindTrimmedInput(organizationInput, (value) => { state.sonarcloudOrganization = value; });

  // Test connection
  const testBtn = $<HTMLButtonElement>('#test-sonarcloud-connection');
  testBtn.addEventListener('click', () => {
    void handleSonarcloudConnectionTest(testBtn, statusContainer);
  });

  projectSelect.addEventListener('change', () => {
    state.sonarcloudProject = projectSelect.value;
  });
}

/** Test SonarCloud connectivity and update the wizard state. */
async function handleSonarcloudConnectionTest(testBtn: HTMLButtonElement, statusContainer: HTMLElement): Promise<void> {
  await runScannerConnectionTest(testBtn, statusContainer, {
    scanner: 'sonarcloud',
    validate: () => {
      if (!state.sonarcloudToken) {
        return 'Please enter a SonarCloud token first.';
      }
      if (!state.sonarcloudOrganization) {
        return 'Please enter a SonarCloud organization key before loading projects.';
      }
      return undefined;
    },
    loadingMessage: 'Testing SonarCloud connection...',
    buildConfig: () => ({
      token: state.sonarcloudToken,
      organization: state.sonarcloudOrganization,
    }),
    invalidFallbackMessage: 'Connection failed. Check your token.',
    formatSuccess: (result) =>
      `Connected! Found ${result.projects_found ?? 0} projects.`,
  });
}

// ── Step: Socket.dev config ──────────────────────────────────────────

function initSocketConfigStep(): void {
  const tokenInput = $<HTMLInputElement>('#socket-token');
  const organizationInput = $<HTMLInputElement>('#socket-organization');
  const statusContainer = $<HTMLElement>('#socket-status');

  tokenInput.value = state.socketToken;
  organizationInput.value = state.socketOrganization;

  bindPasswordVisibilityToggle(tokenInput, $<HTMLButtonElement>('#toggle-socket-token'));
  bindTrimmedInput(tokenInput, (value) => { state.socketToken = value; });
  bindTrimmedInput(organizationInput, (value) => { state.socketOrganization = value; });

  // Test connection
  const testBtn = $<HTMLButtonElement>('#test-socket-connection');
  testBtn.addEventListener('click', () => {
    void handleSocketConnectionTest(testBtn, statusContainer);
  });
}

/** Test Socket.dev connectivity and update the wizard state. */
async function handleSocketConnectionTest(testBtn: HTMLButtonElement, statusContainer: HTMLElement): Promise<void> {
  await runScannerConnectionTest(testBtn, statusContainer, {
    scanner: 'socket',
    validate: () =>
      state.socketToken ? undefined : 'Please enter a Socket.dev token first.',
    loadingMessage: 'Testing Socket.dev connection...',
    buildConfig: () => ({
      token: state.socketToken,
      organization: state.socketOrganization || undefined,
    }),
    invalidFallbackMessage: 'Connection failed. Check your token.',
    formatSuccess: (result) => {
      const orgCount = result.orgs_found ?? 0;
      return `Connected! Found ${orgCount} organization${orgCount === 1 ? '' : 's'}.`;
    },
  });
}

// ── Step: Snyk config ────────────────────────────────────────────────

function initSnykConfigStep(): void {
  const tokenInput = $<HTMLInputElement>('#snyk-token');
  const organizationInput = $<HTMLInputElement>('#snyk-organization');
  const statusContainer = $<HTMLElement>('#snyk-status');

  tokenInput.value = state.snykToken;
  organizationInput.value = state.snykOrganization;

  bindPasswordVisibilityToggle(tokenInput, $<HTMLButtonElement>('#toggle-snyk-token'));
  bindTrimmedInput(tokenInput, (value) => { state.snykToken = value; });
  bindTrimmedInput(organizationInput, (value) => { state.snykOrganization = value; });

  // Test connection
  const testBtn = $<HTMLButtonElement>('#test-snyk-connection');
  testBtn.addEventListener('click', () => {
    void handleSnykConnectionTest(testBtn, statusContainer);
  });
}

/** Test Snyk connectivity and update the wizard state. */
async function handleSnykConnectionTest(testBtn: HTMLButtonElement, statusContainer: HTMLElement): Promise<void> {
  await runScannerConnectionTest(testBtn, statusContainer, {
    scanner: 'snyk',
    validate: () =>
      state.snykToken ? undefined : 'Please enter a Snyk token first.',
    loadingMessage: 'Testing Snyk connection...',
    buildConfig: () => ({
      token: state.snykToken,
      org_id: state.snykOrganization || undefined,
    }),
    invalidFallbackMessage: 'Connection failed. Check your token.',
    formatSuccess: (result) => {
      const orgCount = result.orgs_found ?? 0;
      return `Connected! Found ${orgCount} organization${orgCount === 1 ? '' : 's'}.`;
    },
  });
}

// ── Step: Semgrep config ─────────────────────────────────────────────

function initSemgrepConfigStep(): void {
  const tokenInput = $<HTMLInputElement>('#semgrep-token');
  const deploymentInput = $<HTMLInputElement>('#semgrep-deployment');
  const issueTypeOptions = $$<HTMLElement>('#semgrep-issue-type-options .radio-option');
  const statusContainer = $<HTMLElement>('#semgrep-status');

  tokenInput.value = state.semgrepToken;
  deploymentInput.value = state.semgrepDeployment;

  bindPasswordVisibilityToggle(tokenInput, $<HTMLButtonElement>('#toggle-semgrep-token'));
  bindTrimmedInput(tokenInput, (value) => { state.semgrepToken = value; });
  bindTrimmedInput(deploymentInput, (value) => { state.semgrepDeployment = value; });

  bindRadioOptionSelection(
    radioOptionElements(issueTypeOptions),
    (input) => input.value === state.semgrepIssueType,
    (input) => {
      state.semgrepIssueType = semgrepIssueTypeFromValue(input.value);
      state.setupSaved = false;
    }
  );

  // Test connection
  const testBtn = $<HTMLButtonElement>('#test-semgrep-connection');
  testBtn.addEventListener('click', () => {
    void handleSemgrepConnectionTest(testBtn, statusContainer);
  });
}

/** Test Semgrep connectivity and update the wizard state. */
async function handleSemgrepConnectionTest(testBtn: HTMLButtonElement, statusContainer: HTMLElement): Promise<void> {
  await runScannerConnectionTest(testBtn, statusContainer, {
    scanner: 'semgrep',
    validate: () =>
      state.semgrepToken ? undefined : 'Please enter a Semgrep token first.',
    loadingMessage: 'Testing Semgrep connection...',
    buildConfig: () => ({
      token: state.semgrepToken,
      deployment: state.semgrepDeployment || undefined,
    }),
    invalidFallbackMessage: 'Connection failed. Check your token.',
    formatSuccess: (result) => {
      const deploymentCount = result.projects_found ?? 0;
      return `Connected! Found ${deploymentCount} deployment${deploymentCount === 1 ? '' : 's'}.`;
    },
  });
}

// ── Step: Security settings ──────────────────────────────────────────

function initSecuritySettingsStep(): void {
  const radioOptions = $$<HTMLElement>('[data-step="security-settings"] .radio-option');
  bindRadioOptionSelection(
    radioOptionElements(radioOptions),
    (input) => input.value === state.tokenStorage,
    (input) => {
      state.tokenStorage = tokenStorageFromValue(input.value);
      state.setupSaved = false;
    }
  );
}

/** Build the setup persistence payload from the current wizard state. */
function buildSetupSources(): SaveSetupSource[] {
  const sources: SaveSetupSource[] = [];

  if (state.selectedScanners.has('sarif')) {
    sources.push({
      id: 'local-sarif',
      type: 'sarif',
      name: 'Local SARIF Files',
      enabled: true,
      path: state.sarifFilePath || undefined,
      options: {},
    });
  }

  if (state.selectedScanners.has('github')) {
    sources.push({
      id: 'github-code-scanning',
      type: 'github',
      name: 'GitHub Code Scanning',
      enabled: true,
      token: state.githubToken || undefined,
      options: {
        repositories: selectedGithubRepositories().map((repository) => ({
          owner: repository.owner,
          repo: repository.name,
        })),
      },
    });
  }

  if (state.selectedScanners.has('sonarcloud')) {
    sources.push({
      id: 'sonarcloud',
      type: 'sonarcloud',
      name: 'SonarCloud',
      enabled: true,
      project_key: state.sonarcloudProject || undefined,
      token: state.sonarcloudToken || undefined,
      options: {
        organization: state.sonarcloudOrganization || undefined,
      },
    });
  }

  if (state.selectedScanners.has('socket')) {
    sources.push({
      id: 'socket',
      type: 'socket',
      name: 'Socket.dev',
      enabled: true,
      token: state.socketToken || undefined,
      options: {
        organization: state.socketOrganization || undefined,
      },
    });
  }

  if (state.selectedScanners.has('snyk')) {
    sources.push({
      id: 'snyk',
      type: 'snyk',
      name: 'Snyk',
      enabled: true,
      token: state.snykToken || undefined,
      options: {
        org_id: state.snykOrganization || undefined,
      },
    });
  }

  if (state.selectedScanners.has('semgrep')) {
    sources.push(...buildSemgrepSetupSources({
      token: state.semgrepToken || undefined,
      deployment: state.semgrepDeployment || undefined,
      issueType: state.semgrepIssueType,
    }));
  }

  return sources;
}

/**
 * Build Semgrep setup sources for one selected issue-type mode.
 *
 * Semgrep's API returns Code findings by default and requires `issue_type=sca`
 * for Supply Chain findings. Separate sources keep stale-state isolation stable
 * when the user wants both result sets from the same deployment.
 */
export function buildSemgrepSetupSources(config: SemgrepSetupConfig): SaveSetupSource[] {
  if (config.issueType === 'both') {
    return [
      semgrepSetupSource({ ...config, issueType: 'sast' }),
      {
        ...semgrepSetupSource({ ...config, issueType: 'sca' }),
        id: 'semgrep-supply-chain',
      },
    ];
  }

  return [semgrepSetupSource({ ...config, issueType: config.issueType })];
}

function semgrepSetupSource(config: Omit<SemgrepSetupConfig, 'issueType'> & { readonly issueType: 'sast' | 'sca' }): SaveSetupSource {
  const isSupplyChain = config.issueType === 'sca';
  return {
    id: 'semgrep',
    type: 'semgrep',
    name: isSupplyChain ? 'Semgrep Supply Chain' : 'Semgrep Code',
    enabled: true,
    token: config.token,
    options: {
      deployment: config.deployment,
      issue_type: config.issueType,
    },
  };
}

/** Persist the wizard setup state through the local setup API. */
async function persistSetup(statusContainer: HTMLElement): Promise<boolean> {
  showLoading(statusContainer, 'Saving scanner configuration...');

  try {
    const result = await saveSetup({
      token_storage: state.tokenStorage,
      sources: buildSetupSources(),
    });
    removeLoading(statusContainer);
    state.setupSaved = true;
    state.setupStatus = {
      initialized: true,
      configured_scanners: result.configured_scanners,
      total_findings: state.setupStatus?.total_findings ?? 0,
      mcp_clients_detected: state.setupStatus?.mcp_clients_detected ?? [],
    };

    const warningText = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
    showStatus(statusContainer, 'success', `Saved setup to ${result.config_path}.${warningText}`);
    return true;
  } catch (err) {
    removeLoading(statusContainer);
    showStatus(statusContainer, 'error', `Save failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return false;
  }
}

// ── Step: MCP config ─────────────────────────────────────────────────

function initMcpConfigStep(): void {
  const statusContainer = $<HTMLElement>('#mcp-status');
  const clientList = $<HTMLElement>('#mcp-client-list');

  showLoading(statusContainer, 'Detecting MCP clients...');

  // Fetch the actual server command in parallel so the preview uses the same
  // command/args that the backend will write to the MCP client config.
  getServerCommand()
    .then((command) => {
      state.serverCommand = command;
      const selectedClient = clientList.querySelector<HTMLInputElement>('input[name="mcp-client"]:checked');
      if (selectedClient) {
        updateConfigPreview(selectedClient.value);
      }
    })
    .catch((err: unknown) => {
      console.error('Failed to load server command for preview:', err);
    });

  detectMcpClients()
    .then((detection) => {
      state.mcpClients = detection;
      removeLoading(statusContainer);

      if (detection.clients.length === 0) {
        showStatus(statusContainer, 'warning', 'No MCP clients detected. You can manually configure your client later.');
        return;
      }

      // Render client list
      clientList.innerHTML = '';
      for (const client of detection.clients) {
        renderMcpClientOption(clientList, client);
      }
      bindMcpClientOptions(radioOptionGroup(clientList));

      showStatus(statusContainer, 'success', `Found ${detection.clients.length} MCP client(s).`);
    })
    .catch((err: unknown) => {
      removeLoading(statusContainer);
      showStatus(statusContainer, 'error', `Detection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });

  // Copy config button
  const copyBtn = $<HTMLButtonElement>('#copy-config');
  copyBtn.addEventListener('click', () => {
    void copyConfigPreview(copyBtn, statusContainer);
  });

  // Write config button
  const writeBtn = $<HTMLButtonElement>('#write-mcp-config');
  writeBtn.addEventListener('click', () => {
    void handleWriteMcpConfig(writeBtn, clientList, statusContainer);
  });
}

/** Render one selectable MCP client row. */
function renderMcpClientOption(clientList: HTMLElement, client: McpClientDetection['clients'][number]): void {
  const option = document.createElement('label');
  option.className = 'radio-option';
  option.innerHTML = `
    <input type="radio" name="mcp-client" value="${escapeHtml(client.name)}" ${client.exists ? 'checked' : ''}>
    <div>
      <div class="radio-label">${escapeHtml(client.name)}</div>
      <div class="radio-desc">${escapeHtml(client.config_path)}</div>
    </div>
  `;
  clientList.appendChild(option);
  if (client.exists) {
    updateConfigPreview(client.name);
  }
}

/** Bind rendered MCP client rows through native radio change events.
 *
 * Dynamic MCP client rows use the same radio-card primitive as static setup
 * options, so keyboard and mouse changes must both update selected styling and
 * the generated config preview from the native checked state.
 */
export function bindMcpClientOptions(clientList: RadioOptionGroup, previewClient: (clientName: string) => void = updateConfigPreview): void {
  const selectedClient = mcpSelectedClientName(clientList);
  bindRadioOptionSelection(
    radioOptionElementsFromGroup(clientList),
    (input) => input.value === selectedClient,
    (input) => {
      previewClient(input.value);
    }
  );
}

function mcpSelectedClientName(clientList: RadioOptionGroup): string {
  const selectedClient = clientList.querySelector('input[name="mcp-client"]:checked');
  if (selectedClient) {
    return selectedClient.value;
  }

  const firstClient = clientList.querySelector('input[name="mcp-client"]');
  return firstClient?.value ?? '';
}

/** Write the selected MCP client configuration. */
async function handleWriteMcpConfig(writeBtn: HTMLButtonElement, clientList: HTMLElement, statusContainer: HTMLElement): Promise<void> {
    const selectedClient = clientList.querySelector<HTMLInputElement>('input[name="mcp-client"]:checked');
    if (!selectedClient) {
      showStatus(statusContainer, 'error', 'Please select an MCP client first.');
      return;
    }

    showLoading(statusContainer, 'Writing configuration...');
    writeBtn.disabled = true;

    try {
      const config = buildMcpConfig(selectedClient.value);
      const result = await writeConfig(selectedClient.value, config, true);
      state.configResults.set(selectedClient.value, result);
      removeLoading(statusContainer);

      if (result.success) {
        let msg = `Configuration written to ${result.config_path}`;
        if (result.backup_path) {
          msg += ` (backup: ${result.backup_path})`;
        }
        showStatus(statusContainer, 'success', msg);
      } else {
        showStatus(statusContainer, 'error', result.message);
      }
    } catch (err) {
      removeLoading(statusContainer);
      showStatus(statusContainer, 'error', `Write failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      writeBtn.disabled = false;
    }
}

/** Build MCP server config for a specific client. */
function buildMcpConfig(clientName: string): Record<string, unknown> {
  // Use the actual server command returned by the backend so the preview
  // matches exactly what will be written to the MCP client config file.
  const command = state.serverCommand?.command ?? 'oh-my-triage';
  const args = state.serverCommand?.args ?? ['server'];
  const serverConfig = {
    command,
    args,
    env: {},
  };

  // Generate client-specific format
  switch (clientName.toLowerCase()) {
    case 'vscode': {
      return {
        servers: {
          'oh-my-triage': {
            type: 'stdio',
            ...serverConfig,
          },
        },
      };
    }
    case 'opencode': {
      return {
        mcp: {
          'oh-my-triage': {
            type: 'local',
            command: [command, ...args],
            enabled: true,
            environment: {},
          },
        },
      };
    }
    default: {
      // Claude Desktop, Cursor, Claude Code, Windsurf, Cline, and others
      return {
        mcpServers: {
          'oh-my-triage': serverConfig,
        },
      };
    }
  }
}

/** Update the config preview pane to match what will be written. */
function updateConfigPreview(clientName: string): void {
  const configPreview = $<HTMLElement>('#config-preview-content');
  const config = buildMcpConfig(clientName);
  configPreview.textContent = JSON.stringify(config, null, 2);
}

/** Copy the current config preview text to the clipboard. */
async function copyConfigPreview(copyBtn: HTMLButtonElement, statusContainer: HTMLElement): Promise<void> {
  const configPreview = $<HTMLElement>('#config-preview-content');
  const text = configPreview.textContent ?? '';
  try {
    await navigator.clipboard.writeText(text);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = 'Copied!';
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  } catch (err: unknown) {
    showStatus(statusContainer, 'error', `Copy failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  }
}

// ── Step: Summary ────────────────────────────────────────────────────

function initSummaryStep(): void {
  const scannerList = $<HTMLElement>('#summary-scanners');
  const findingsCount = $<HTMLElement>('#summary-findings-count');
  const scannersCount = $<HTMLElement>('#summary-scanners-count');
  const clientsCount = $<HTMLElement>('#summary-clients-count');

  scannerList.innerHTML = '';

  const scannerLabels: Record<string, string> = {
    sarif: 'SARIF Files',
    github: 'GitHub Code Scanning',
    sonarcloud: 'SonarCloud',
    socket: 'Socket.dev',
    snyk: 'Snyk',
    semgrep: 'Semgrep',
  };

  state.selectedScanners.forEach((scanner) => {
    const result = state.connectionResults.get(scanner);
    const isConnected = result?.valid ?? false;

    const div = document.createElement('div');
    div.className = 'scanner-item';
    div.innerHTML = `
      <span class="scanner-status ${isConnected ? 'connected' : ''}"></span>
      <span class="scanner-name">${escapeHtml(scannerLabels[scanner] ?? scanner)}</span>
      <span class="scanner-detail">${isConnected ? 'Connected' : 'Not tested'}</span>
    `;
    scannerList.appendChild(div);
  });

  // Update findings count
  const totalFindings = state.setupStatus?.total_findings ?? 0;
  findingsCount.textContent = String(totalFindings);
  scannersCount.textContent = String(state.selectedScanners.size);
  clientsCount.textContent = String(state.configResults.size);

  // Update nav button
  updateNavButtons();
}

// ── Navigation buttons ───────────────────────────────────────────────

function initNavigation(): void {
  const prevBtn = $<HTMLButtonElement>('#btn-prev');
  const nextBtn = $<HTMLButtonElement>('#btn-next');

  prevBtn.addEventListener('click', () => {
    const prev = getPrevStep(state.currentStep);
    if (prev) goToStep(prev);
  });

  nextBtn.addEventListener('click', () => {
    void handleNextNavigation(nextBtn);
  });
}

/** Advance the wizard or prepare the server command from the summary step. */
async function handleNextNavigation(nextBtn: HTMLButtonElement): Promise<void> {
    if (state.currentStep === 'summary') {
      const statusContainer = $<HTMLElement>('#summary-status');
      showLoading(statusContainer, 'Preparing MCP server command...');
      nextBtn.disabled = true;
      try {
        const result = await startServer();
        removeLoading(statusContainer);
        showStatus(statusContainer, result.success ? 'success' : 'warning', result.message);
      } catch (err) {
        removeLoading(statusContainer);
        showStatus(statusContainer, 'error', `Unable to prepare server command: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        nextBtn.disabled = false;
      }
      return;
    }

    const next = getNextStep(state.currentStep);
    if (!next) return;

    if (state.currentStep === 'github-config' && !hasSelectedGithubRepositories()) {
      showStatus($<HTMLElement>('#github-status'), 'error', 'Test the GitHub connection and select at least one repository before continuing.');
      return;
    }

    if (state.currentStep === 'security-settings') {
      const saved = await persistSetup($<HTMLElement>('#security-status'));
      if (!saved) return;
    }

    goToStep(next);
}

function hasSelectedGithubRepositories(): boolean {
  return Boolean(state.githubToken && state.githubSelectedRepositories.size > 0);
}

// ── Initialize ───────────────────────────────────────────────────────

/**
 * Initialize the setup wizard application.
 *
 * Binds all event listeners, loads initial state, and shows the
 * first step panel. Called once on DOMContentLoaded.
 */
export function initApp(): void {
  initNavigation();
  initWelcomeStep();
  initScannerSelectStep();
  initSarifConfigStep();
  initGithubConfigStep();
  initSonarcloudConfigStep();
  initSocketConfigStep();
  initSnykConfigStep();
  initSemgrepConfigStep();
  initSecuritySettingsStep();

  // Show initial step
  goToStep('welcome');
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

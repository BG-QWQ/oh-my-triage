/**
 * FindingBridge Setup Wizard — client-side application logic.
 *
 * Manages the 8-step setup flow: welcome, scanner selection, per-scanner
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
  getSetupStatus,
  testConnection,
  detectMcpClients,
  writeConfig,
  saveSetup,
  startServer,
} from './setup-api.js';

// ── Wizard state ──────────────────────────────────────────────────────

/** All wizard step IDs in order */
const STEPS = [
  'welcome',
  'scanner-select',
  'sarif-config',
  'github-config',
  'sonarcloud-config',
  'security-settings',
  'mcp-config',
  'summary',
] as const;

type StepId = (typeof STEPS)[number];

const SCANNER_CONFIG_STEPS: Array<{ scanner: ScannerType; step: StepId }> = [
  { scanner: 'sarif', step: 'sarif-config' },
  { scanner: 'github', step: 'github-config' },
  { scanner: 'sonarcloud', step: 'sonarcloud-config' },
];

/** Wizard state tracked across steps */
interface WizardState {
  currentStep: StepId;
  selectedScanners: Set<ScannerType>;
  sarifFilePath: string;
  githubToken: string;
  githubOrg: string;
  githubRepo: string;
  sonarcloudToken: string;
  sonarcloudOrganization: string;
  sonarcloudProject: string;
  tokenStorage: TokenStorage;
  connectionResults: Map<ScannerType, TestConnectionResponse>;
  mcpClients: McpClientDetection | null;
  configResults: Map<string, WriteConfigResponse>;
  setupStatus: SetupStatus | null;
  setupSaved: boolean;
}

const state: WizardState = {
  currentStep: 'welcome',
  selectedScanners: new Set(),
  sarifFilePath: '',
  githubToken: '',
  githubOrg: '',
  githubRepo: '',
  sonarcloudToken: '',
  sonarcloudOrganization: '',
  sonarcloudProject: '',
  tokenStorage: 'keychain',
  connectionResults: new Map(),
  mcpClients: null,
  configResults: new Map(),
  setupStatus: null,
  setupSaved: false,
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
    .catch(() => {
      removeLoading(statusContainer);
      showStatus(statusContainer, 'warning', 'Could not reach the setup server. You can still configure settings locally.');
    });
}

// ── Step: Scanner selection ──────────────────────────────────────────

function initScannerSelectStep(): void {
  const cards = $$('.checkbox-card');
  cards.forEach((card) => {
    const input = card.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) return;

    // Restore previous selection
    if (state.selectedScanners.has(input.value as ScannerType)) {
      card.classList.add('selected');
    }

    card.addEventListener('click', () => {
      input.checked = !input.checked;
      card.classList.toggle('selected', input.checked);

      if (input.checked) {
        state.selectedScanners.add(input.value as ScannerType);
      } else {
        state.selectedScanners.delete(input.value as ScannerType);
      }
    });
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
  const repoSelect = $<HTMLSelectElement>('#github-repo');
  const statusContainer = $<HTMLElement>('#github-status');

  tokenInput.value = state.githubToken;

  // Toggle password visibility
  const toggleBtn = $<HTMLButtonElement>('#toggle-github-token');
  toggleBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
  });

  tokenInput.addEventListener('input', () => {
    state.githubToken = tokenInput.value.trim();
  });

  // Test connection
  const testBtn = $<HTMLButtonElement>('#test-github-connection');
  testBtn.addEventListener('click', () => {
    void handleGithubConnectionTest(testBtn, statusContainer);
  });

  orgSelect.addEventListener('change', () => {
    state.githubOrg = orgSelect.value;
  });

  repoSelect.addEventListener('change', () => {
    state.githubRepo = repoSelect.value;
  });
}

/** Test GitHub connectivity and update the wizard state. */
async function handleGithubConnectionTest(testBtn: HTMLButtonElement, statusContainer: HTMLElement): Promise<void> {
  if (!state.githubToken) {
    showStatus(statusContainer, 'error', 'Please enter a GitHub token first.');
    return;
  }

  showLoading(statusContainer, 'Testing GitHub connection...');
  testBtn.disabled = true;

  try {
    const result = await testConnection('github', {
      token: state.githubToken,
    });
    removeLoading(statusContainer);

    if (result.valid) {
      state.connectionResults.set('github', result);
      showStatus(statusContainer, 'success', `Connected! Found ${result.projects_found ?? 0} accessible repositories.`);
    } else {
      showStatus(statusContainer, 'error', result.reason ?? 'Connection failed. Check your token and permissions.');
      if (result.suggestion) {
        showStatus(statusContainer, 'warning', result.suggestion);
      }
    }
  } catch (err) {
    removeLoading(statusContainer);
    showStatus(statusContainer, 'error', `Connection test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    testBtn.disabled = false;
  }
}

// ── Step: SonarCloud config ──────────────────────────────────────────

function initSonarcloudConfigStep(): void {
  const tokenInput = $<HTMLInputElement>('#sonarcloud-token');
  const organizationInput = $<HTMLInputElement>('#sonarcloud-organization');
  const projectSelect = $<HTMLSelectElement>('#sonarcloud-project');
  const statusContainer = $<HTMLElement>('#sonarcloud-status');

  tokenInput.value = state.sonarcloudToken;
  organizationInput.value = state.sonarcloudOrganization;

  // Toggle password visibility
  const toggleBtn = $<HTMLButtonElement>('#toggle-sonarcloud-token');
  toggleBtn.addEventListener('click', () => {
    const isPassword = tokenInput.type === 'password';
    tokenInput.type = isPassword ? 'text' : 'password';
    toggleBtn.textContent = isPassword ? 'Hide' : 'Show';
  });

  tokenInput.addEventListener('input', () => {
    state.sonarcloudToken = tokenInput.value.trim();
  });

  organizationInput.addEventListener('input', () => {
    state.sonarcloudOrganization = organizationInput.value.trim();
  });

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
    if (!state.sonarcloudToken) {
      showStatus(statusContainer, 'error', 'Please enter a SonarCloud token first.');
      return;
    }

    if (!state.sonarcloudOrganization) {
      showStatus(statusContainer, 'error', 'Please enter a SonarCloud organization key before loading projects.');
      return;
    }

    showLoading(statusContainer, 'Testing SonarCloud connection...');
    testBtn.disabled = true;

    try {
      const result = await testConnection('sonarcloud', {
        token: state.sonarcloudToken,
        organization: state.sonarcloudOrganization,
      });
      removeLoading(statusContainer);

      if (result.valid) {
        state.connectionResults.set('sonarcloud', result);
        showStatus(statusContainer, 'success', `Connected! Found ${result.projects_found ?? 0} projects.`);
      } else {
        showStatus(statusContainer, 'error', result.reason ?? 'Connection failed. Check your token.');
        if (result.suggestion) {
          showStatus(statusContainer, 'warning', result.suggestion);
        }
      }
    } catch (err) {
      removeLoading(statusContainer);
      showStatus(statusContainer, 'error', `Connection test failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      testBtn.disabled = false;
    }
}

// ── Step: Security settings ──────────────────────────────────────────

function initSecuritySettingsStep(): void {
  const radioOptions = $$('.radio-option');
  radioOptions.forEach((option) => {
    const input = option.querySelector<HTMLInputElement>('input[type="radio"]');
    if (!input) return;

    if (input.value === state.tokenStorage) {
      option.classList.add('selected');
    }

    option.addEventListener('click', () => {
      radioOptions.forEach((o) => o.classList.remove('selected'));
      option.classList.add('selected');
      input.checked = true;
      state.tokenStorage = input.value as TokenStorage;
      state.setupSaved = false;
    });
  });
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
        owner: state.githubOrg || undefined,
        repo: state.githubRepo || undefined,
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

  return sources;
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

      showStatus(statusContainer, 'success', `Found ${detection.clients.length} MCP client(s).`);
    })
    .catch((err: unknown) => {
      removeLoading(statusContainer);
      showStatus(statusContainer, 'error', `Detection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });

  // Write config button
  const writeBtn = $<HTMLButtonElement>('#write-mcp-config');
  writeBtn.addEventListener('click', () => {
    void handleWriteMcpConfig(writeBtn, clientList, statusContainer);
  });
}

/** Render one selectable MCP client row. */
function renderMcpClientOption(clientList: HTMLElement, client: McpClientDetection['clients'][number]): void {
  const div = document.createElement('div');
  div.className = 'radio-option';
  div.innerHTML = `
    <input type="radio" name="mcp-client" value="${escapeHtml(client.name)}" ${client.exists ? 'checked' : ''}>
    <div>
      <div class="radio-label">${escapeHtml(client.name)}</div>
      <div class="radio-desc">${escapeHtml(client.config_path)}</div>
    </div>
  `;
  div.addEventListener('click', () => selectMcpClient(clientList, div, client.name));
  if (client.exists) {
    div.classList.add('selected');
    updateConfigPreview(client.name);
  }
  clientList.appendChild(div);
}

/** Mark an MCP client option as selected and refresh the preview. */
function selectMcpClient(clientList: HTMLElement, option: HTMLElement, clientName: string): void {
  clientList.querySelectorAll('.radio-option').forEach((o) => o.classList.remove('selected'));
  option.classList.add('selected');
  option.querySelector<HTMLInputElement>('input[type="radio"]')!.checked = true;
  updateConfigPreview(clientName);
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

/** Build MCP server config for a specific client */
function buildMcpConfig(clientName: string): Record<string, unknown> {
  // Base server config
  const serverConfig = {
    command: 'findingbridge',
    args: ['server'],
    env: {},
  };

  // Generate client-specific format
  switch (clientName.toLowerCase()) {
    case 'vscode': {
      return {
        servers: {
          findingbridge: {
            type: 'stdio',
            ...serverConfig,
          },
        },
      };
    }
    case 'opencode': {
      return {
        mcp: {
          findingbridge: {
            type: 'local',
            command: ['findingbridge', 'server'],
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
          findingbridge: serverConfig,
        },
      };
    }
  }
}

/** Update the config preview pane */
function updateConfigPreview(clientName: string): void {
  const configPreview = $<HTMLElement>('#config-preview-content');
  const config = buildMcpConfig(clientName);

  // Add client-specific metadata
  const fullConfig = {
    _comment: `Configuration for ${clientName}`,
    ...config,
  };

  configPreview.textContent = JSON.stringify(fullConfig, null, 2);
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

    if (state.currentStep === 'security-settings') {
      const saved = await persistSetup($<HTMLElement>('#security-status'));
      if (!saved) return;
    }

    goToStep(next);
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
  initSecuritySettingsStep();

  // Show initial step
  goToStep('welcome');
}

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

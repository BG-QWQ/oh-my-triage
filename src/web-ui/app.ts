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
  getSetupStatus,
  testConnection,
  detectMcpClients,
  writeConfig,
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

/** Wizard state tracked across steps */
interface WizardState {
  currentStep: StepId;
  selectedScanners: Set<ScannerType>;
  sarifFilePath: string;
  githubToken: string;
  githubOrg: string;
  githubRepo: string;
  sonarcloudToken: string;
  sonarcloudProject: string;
  tokenStorage: 'keychain' | 'plaintext' | 'env';
  connectionResults: Map<ScannerType, TestConnectionResponse>;
  mcpClients: McpClientDetection | null;
  configResults: Map<string, WriteConfigResponse>;
  setupStatus: SetupStatus | null;
}

const state: WizardState = {
  currentStep: 'welcome',
  selectedScanners: new Set(),
  sarifFilePath: '',
  githubToken: '',
  githubOrg: '',
  githubRepo: '',
  sonarcloudToken: '',
  sonarcloudProject: '',
  tokenStorage: 'keychain',
  connectionResults: new Map(),
  mcpClients: null,
  configResults: new Map(),
  setupStatus: null,
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
  const idx = STEPS.indexOf(current);
  if (idx === STEPS.length - 1) return null;

  // Skip scanner config steps if scanner not selected
  if (current === 'scanner-select') {
    if (state.selectedScanners.has('sarif')) return 'sarif-config';
    if (state.selectedScanners.has('github')) return 'github-config';
    if (state.selectedScanners.has('sonarcloud')) return 'sonarcloud-config';
    return 'security-settings';
  }
  if (current === 'sarif-config') {
    if (state.selectedScanners.has('github')) return 'github-config';
    if (state.selectedScanners.has('sonarcloud')) return 'sonarcloud-config';
    return 'security-settings';
  }
  if (current === 'github-config') {
    if (state.selectedScanners.has('sonarcloud')) return 'sonarcloud-config';
    return 'security-settings';
  }

  return STEPS[idx + 1];
}

/** Determine which step comes before */
function getPrevStep(current: StepId): StepId | null {
  const idx = STEPS.indexOf(current);
  if (idx === 0) return null;

  // Skip scanner config steps if scanner not selected
  if (current === 'security-settings') {
    if (state.selectedScanners.has('sonarcloud')) return 'sonarcloud-config';
    if (state.selectedScanners.has('github')) return 'github-config';
    if (state.selectedScanners.has('sarif')) return 'sarif-config';
    return 'scanner-select';
  }
  if (current === 'sonarcloud-config') {
    if (state.selectedScanners.has('github')) return 'github-config';
    if (state.selectedScanners.has('sarif')) return 'sarif-config';
    return 'scanner-select';
  }
  if (current === 'github-config') {
    if (state.selectedScanners.has('sarif')) return 'sarif-config';
    return 'scanner-select';
  }

  return STEPS[idx - 1];
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
  testBtn.addEventListener('click', async () => {
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
        // Populate org/repo selects if data available
        if (result.orgs_found && result.orgs_found > 0) {
          orgSelect.innerHTML = '<option value="">Select organization</option>';
          // Placeholder — real data comes from API
        }
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
  });

  orgSelect.addEventListener('change', () => {
    state.githubOrg = orgSelect.value;
  });

  repoSelect.addEventListener('change', () => {
    state.githubRepo = repoSelect.value;
  });
}

// ── Step: SonarCloud config ──────────────────────────────────────────

function initSonarcloudConfigStep(): void {
  const tokenInput = $<HTMLInputElement>('#sonarcloud-token');
  const projectSelect = $<HTMLSelectElement>('#sonarcloud-project');
  const statusContainer = $<HTMLElement>('#sonarcloud-status');

  tokenInput.value = state.sonarcloudToken;

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

  // Test connection
  const testBtn = $<HTMLButtonElement>('#test-sonarcloud-connection');
  testBtn.addEventListener('click', async () => {
    if (!state.sonarcloudToken) {
      showStatus(statusContainer, 'error', 'Please enter a SonarCloud token first.');
      return;
    }

    showLoading(statusContainer, 'Testing SonarCloud connection...');
    testBtn.disabled = true;

    try {
      const result = await testConnection('sonarcloud', {
        token: state.sonarcloudToken,
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
  });

  projectSelect.addEventListener('change', () => {
    state.sonarcloudProject = projectSelect.value;
  });
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
      state.tokenStorage = input.value as 'keychain' | 'plaintext' | 'env';
    });
  });
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
      detection.clients.forEach((client) => {
        const div = document.createElement('div');
        div.className = 'radio-option';
        div.innerHTML = `
          <input type="radio" name="mcp-client" value="${escapeHtml(client.name)}" ${client.exists ? 'checked' : ''}>
          <div>
            <div class="radio-label">${escapeHtml(client.name)}</div>
            <div class="radio-desc">${escapeHtml(client.config_path)}</div>
          </div>
        `;
        div.addEventListener('click', () => {
          clientList.querySelectorAll('.radio-option').forEach((o) => o.classList.remove('selected'));
          div.classList.add('selected');
          div.querySelector<HTMLInputElement>('input[type="radio"]')!.checked = true;
          updateConfigPreview(client.name);
        });
        if (client.exists) {
          div.classList.add('selected');
          updateConfigPreview(client.name);
        }
        clientList.appendChild(div);
      });

      showStatus(statusContainer, 'success', `Found ${detection.clients.length} MCP client(s).`);
    })
    .catch((err: unknown) => {
      removeLoading(statusContainer);
      showStatus(statusContainer, 'error', `Detection failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    });

  // Write config button
  const writeBtn = $<HTMLButtonElement>('#write-mcp-config');
  writeBtn.addEventListener('click', async () => {
    const selectedClient = clientList.querySelector<HTMLInputElement>('input[name="mcp-client"]:checked');
    if (!selectedClient) {
      showStatus(statusContainer, 'error', 'Please select an MCP client first.');
      return;
    }

    showLoading(statusContainer, 'Writing configuration...');
    writeBtn.disabled = true;

    try {
      const config = buildMcpConfig();
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
  });
}

/** Build MCP server config from wizard state */
function buildMcpConfig(): Record<string, unknown> {
  const mcpServers: Record<string, unknown> = {};

  if (state.selectedScanners.has('sarif') || state.selectedScanners.has('github') || state.selectedScanners.has('sonarcloud')) {
    mcpServers.findingbridge = {
      command: 'findingbridge',
      args: ['server'],
      env: {},
    };
  }

  return { mcpServers };
}

/** Update the config preview pane */
function updateConfigPreview(clientName: string): void {
  const configPreview = $<HTMLElement>('#config-preview-content');
  const config = buildMcpConfig();

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
    if (state.currentStep === 'summary') {
      // "Start Server" action
      const statusContainer = $<HTMLElement>('#summary-status');
      showStatus(statusContainer, 'info', 'Starting FindingBridge server... Check your terminal for the MCP connection details.');
      return;
    }

    const next = getNextStep(state.currentStep);
    if (next) goToStep(next);
  });
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

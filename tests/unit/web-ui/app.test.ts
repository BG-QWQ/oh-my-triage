import { describe, expect, it } from 'vitest';
import {
  bindMcpClientOptions,
  bindRadioOptionSelection,
  bindScannerCardSelection,
  buildInvalidConnectionMessages,
  buildSemgrepSetupSources,
  bindWelcomeStartButton,
  formatConnectionTestError,
} from '@/web-ui/app.js';
import type { RadioOptionElement, RadioOptionGroup, SelectableCard, SelectableInput } from '@/web-ui/app.js';
import type { ScannerType } from '@/web-ui/setup-api.js';

type TestClassList = {
  readonly add: (className: string) => void;
  readonly remove: (className: string) => void;
  readonly toggle: (className: string, force?: boolean) => boolean;
  readonly contains: (className: string) => boolean;
};

class TestInputElement extends EventTarget implements SelectableInput {
  public constructor(
    public value: string,
    public checked = false
  ) {
    super();
  }
}

class TestLabelElement implements RadioOptionElement {
  private readonly classes = new Set<string>();

  public readonly classList: TestClassList = {
    add: (className) => {
      this.classes.add(className);
    },
    remove: (className) => {
      this.classes.delete(className);
    },
    toggle: (className, force) => {
      const selected = force ?? !this.classes.has(className);
      if (selected) {
        this.classes.add(className);
      } else {
        this.classes.delete(className);
      }
      return selected;
    },
    contains: (className) => this.classes.has(className),
  };

  public constructor(private input: SelectableInput | null = null) {}

  public querySelector(selector: string): SelectableInput | null {
    if (selector === 'input[type="radio"]') {
      return this.input;
    }

    return null;
  }
}

class TestRadioGroupElement implements RadioOptionGroup {
  public constructor(private readonly options: readonly RadioOptionElement[]) {}

  public querySelectorAll(_selector: string): RadioOptionElement[] {
    return [...this.options];
  }

  public querySelector(_selector: string): SelectableInput | null {
    for (const option of this.options) {
      const input = option.querySelector('input[type="radio"]');
      if (input?.checked) {
        return input;
      }
    }

    return null;
  }
}

describe('buildInvalidConnectionMessages', () => {
  it('returns an empty array for a valid result', () => {
    expect(buildInvalidConnectionMessages({ valid: true }, 'fallback')).toEqual([]);
  });

  it('returns the reason as an error when the result is invalid', () => {
    expect(buildInvalidConnectionMessages({ valid: false, reason: 'Bad token' }, 'fallback')).toEqual([
      { type: 'error', message: 'Bad token' },
    ]);
  });

  it('falls back to the scanner-specific message when no reason is provided', () => {
    expect(buildInvalidConnectionMessages({ valid: false }, 'fallback message')).toEqual([
      { type: 'error', message: 'fallback message' },
    ]);
  });

  it('appends a warning after the error when a suggestion is provided', () => {
    expect(
      buildInvalidConnectionMessages(
        { valid: false, reason: 'Bad token', suggestion: 'Regenerate your token' },
        'fallback'
      )
    ).toEqual([
      { type: 'error', message: 'Bad token' },
      { type: 'warning', message: 'Regenerate your token' },
    ]);
  });
});

describe('formatConnectionTestError', () => {
  it('includes the error message for Error instances', () => {
    expect(formatConnectionTestError(new Error('network down'))).toBe(
      'Connection test failed: network down'
    );
  });

  it('uses a generic message for non-Error values', () => {
    expect(formatConnectionTestError('something happened')).toBe(
      'Connection test failed: Unknown error'
    );
  });
});

describe('buildSemgrepSetupSources', () => {
  it('builds one Semgrep Code source when SAST only is selected', () => {
    const sources = buildSemgrepSetupSources({
      token: 'token-123',
      deployment: 'acme-deployment',
      issueType: 'sast',
    });

    expect(sources).toEqual([
      {
        id: 'semgrep',
        type: 'semgrep',
        name: 'Semgrep Code',
        enabled: true,
        token: 'token-123',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sast',
        },
      },
    ]);
  });

  it('builds one Semgrep Supply Chain source when SCA only is selected', () => {
    const sources = buildSemgrepSetupSources({
      token: 'token-123',
      deployment: 'acme-deployment',
      issueType: 'sca',
    });

    expect(sources).toEqual([
      {
        id: 'semgrep',
        type: 'semgrep',
        name: 'Semgrep Supply Chain',
        enabled: true,
        token: 'token-123',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sca',
        },
      },
    ]);
  });

  it('builds separate Semgrep Code and Supply Chain sources when both are selected', () => {
    const sources = buildSemgrepSetupSources({
      token: 'token-123',
      deployment: 'acme-deployment',
      issueType: 'both',
    });

    expect(sources).toEqual([
      expect.objectContaining({
        id: 'semgrep',
        name: 'Semgrep Code',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sast',
        },
      }),
      expect.objectContaining({
        id: 'semgrep-supply-chain',
        name: 'Semgrep Supply Chain',
        options: {
          deployment: 'acme-deployment',
          issue_type: 'sca',
        },
      }),
    ]);
  });
});

describe('bindWelcomeStartButton', () => {
  it('navigates to scanner selection when the welcome CTA is clicked', () => {
    let nextStep = '';
    const button = new EventTarget();

    bindWelcomeStartButton(button, (step) => {
      nextStep = step;
    });
    button.dispatchEvent(new Event('click'));

    expect(nextStep).toBe('scanner-select');
  });
});

describe('bindScannerCardSelection', () => {
  it('syncs selected scanners when the native checkbox changes', () => {
    const selectedScanners = new Set<ScannerType>();
    const card: SelectableCard & { readonly classList: TestClassList } = new TestLabelElement();
    const input: SelectableInput & EventTarget = new TestInputElement('sarif');

    bindScannerCardSelection(input, card, selectedScanners);
    input.checked = true;
    input.dispatchEvent(new Event('change'));

    expect(selectedScanners.has('sarif')).toBe(true);
    expect(card.classList.contains('selected')).toBe(true);
  });
});

describe('bindRadioOptionSelection', () => {
  it('syncs the selected radio card when the native radio changes', () => {
    const sastInput: SelectableInput & EventTarget = new TestInputElement('sast');
    const scaInput: SelectableInput & EventTarget = new TestInputElement('sca');
    const sastOption: RadioOptionElement & { readonly classList: TestClassList } = new TestLabelElement(sastInput);
    const scaOption: RadioOptionElement & { readonly classList: TestClassList } = new TestLabelElement(scaInput);

    let selectedIssueType = 'sast';
    bindRadioOptionSelection(
      [sastOption, scaOption],
      (input) => input.value === selectedIssueType,
      (input) => {
        selectedIssueType = input.value;
      }
    );

    sastInput.checked = false;
    scaInput.checked = true;
    scaInput.dispatchEvent(new Event('change'));

    expect(selectedIssueType).toBe('sca');
    expect(sastOption.classList.contains('selected')).toBe(false);
    expect(scaOption.classList.contains('selected')).toBe(true);
  });
});

describe('bindMcpClientOptions', () => {
  it('syncs the selected MCP row when the native radio changes', () => {
    const claudeInput: SelectableInput & EventTarget = new TestInputElement('Claude', true);
    const cursorInput: SelectableInput & EventTarget = new TestInputElement('Cursor');
    const claudeOption: RadioOptionElement & { readonly classList: TestClassList } = new TestLabelElement(claudeInput);
    const cursorOption: RadioOptionElement & { readonly classList: TestClassList } = new TestLabelElement(cursorInput);
    const group = new TestRadioGroupElement([claudeOption, cursorOption]);
    let previewedClient = '';

    bindMcpClientOptions(group, (clientName) => {
      previewedClient = clientName;
    });
    claudeInput.checked = false;
    cursorInput.checked = true;
    cursorInput.dispatchEvent(new Event('change'));

    expect(claudeOption.classList.contains('selected')).toBe(false);
    expect(cursorOption.classList.contains('selected')).toBe(true);
    expect(previewedClient).toBe('Cursor');
  });
});

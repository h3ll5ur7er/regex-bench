import { ChangeDetectionStrategy, Component, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { SynthesisManager } from '../managers/synthesis.manager';
import { WorkbenchManager } from '../managers/workbench.manager';
import { Icon } from './icon';
import { UiState } from './ui-state';

const STEP_TEXT: Record<string, string> = {
  start: 'Start a match attempt at position',
  try: 'Try',
  match: 'Matched',
  fail: 'Failed',
  backtrack: 'Backtrack from',
  success: 'Match found, ending at position',
};

/** Step through the engine's work, and see where it spends its time (US-12). */
@Component({
  selector: 'rb-debug-panel',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (synth.traceError(); as e) {
      <p class="muted">{{ e }}</p>
    } @else if (synth.trace(); as t) {
      <div class="summary">
        @if (t.exhausted) {
          <div class="alert">
            <b>Catastrophic backtracking.</b> The engine took over {{ t.stepCount.toLocaleString() }} steps and was stopped.
            Each extra character can double the work. Look for nested repetition like <code class="mono">(a+)+</code>.
          </div>
        }
        <div class="stats">
          <div><span class="label">Result</span><b>{{ t.match ? 'Match at ' + t.match.start + '–' + t.match.end : t.exhausted ? 'Gave up' : 'No match' }}</b></div>
          <div><span class="label">Steps</span><b>{{ t.stepCount.toLocaleString() }}</b></div>
          <div><span class="label">Backtracks</span><b>{{ backtracks().toLocaleString() }}</b></div>
          <div class="heat" [title]="'Steps spent at each start position'">
            <span class="label">Effort per start position</span>
            <div class="bars">
              @for (h of heat(); track $index) {
                <span [style.height.%]="h"></span>
              }
            </div>
          </div>
        </div>
      </div>
      <div class="player">
        <button class="btn icon" title="First step" (click)="go(0)"><rb-icon name="first" /></button>
        <button class="btn icon" title="Previous step (←)" (click)="go(step() - 1)"><rb-icon name="prev" /></button>
        <button class="btn icon primary" [title]="playing() ? 'Pause' : 'Play'" (click)="togglePlay()"><rb-icon [name]="playing() ? 'pause' : 'play'" /></button>
        <button class="btn icon" title="Next step (→)" (click)="go(step() + 1)"><rb-icon name="next" /></button>
        <button class="btn icon" title="Last step" (click)="go(t.steps.length - 1)"><rb-icon name="last" /></button>
        <input type="range" min="0" [max]="t.steps.length - 1" [value]="step()" (input)="go(+$any($event.target).value)" aria-label="Step" />
        <span class="mono pos">{{ (step() + 1).toLocaleString() }} / {{ t.steps.length.toLocaleString() }}</span>
      </div>
      @if (current(); as c) {
        <p class="now" [class]="c.kind">
          <span class="kind">{{ c.kind }}</span>
          {{ describe() }}
        </p>
      }
      @if (t.steps.length < t.stepCount) {
        <p class="muted small">Recorded the first {{ t.steps.length.toLocaleString() }} steps.</p>
      }
    } @else {
      <p class="muted">{{ synth.traceRunning() ? 'Tracing…' : 'Type a pattern and some text to step through the match.' }}</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .alert { padding: 8px 12px; border-radius: 8px; background: var(--err-soft); font-size: 13px; }
    .stats { display: flex; gap: 24px; align-items: flex-end; flex-wrap: wrap; }
    .stats > div { display: flex; flex-direction: column; gap: 2px; }
    .heat { flex: 1; min-width: 160px; }
    .bars { display: flex; align-items: flex-end; gap: 1px; height: 28px; }
    .bars span { flex: 1; min-width: 1px; background: var(--accent); opacity: .75; border-radius: 1px 1px 0 0; }
    .player { display: flex; align-items: center; gap: 6px; }
    input[type='range'] { flex: 1; accent-color: var(--accent); }
    .pos { font-size: 12px; color: var(--text-2); min-width: 110px; text-align: right; }
    .now { margin: 0; padding: 8px 12px; border-radius: 8px; background: var(--surface-2); font-size: 13px; }
    .now.fail, .now.backtrack { background: var(--err-soft); }
    .now.match, .now.success { background: var(--ok-soft); }
    .kind { font-size: 11px; text-transform: uppercase; font-weight: 700; letter-spacing: .05em; margin-right: 8px; }
    .small { font-size: 12px; margin: 0; }
  `,
})
export class DebugPanel implements OnDestroy {
  protected readonly synth = inject(SynthesisManager);
  private readonly wb = inject(WorkbenchManager);
  private readonly ui = inject(UiState);
  protected readonly step = this.ui.debugStep;
  protected readonly playing = signal(false);
  private timer?: ReturnType<typeof setInterval>;

  protected readonly current = computed(() => {
    const t = this.synth.trace();
    return t?.steps[Math.min(this.step(), t.steps.length - 1)] ?? null;
  });

  protected readonly backtracks = computed(() => this.synth.trace()?.steps.filter((s) => s.kind === 'backtrack').length ?? 0);

  protected readonly heat = computed(() => {
    const per = this.synth.trace()?.stepsPerStart ?? [];
    const bins = 60;
    const size = Math.max(1, Math.ceil(per.length / bins));
    const vals: number[] = [];
    for (let i = 0; i < per.length; i += size) vals.push(per.slice(i, i + size).reduce((a, b) => a + b, 0));
    const max = Math.max(1, ...vals);
    return vals.map((v) => Math.max(4, (v / max) * 100));
  });

  protected readonly describe = computed(() => {
    const c = this.current();
    if (!c) return '';
    const src = this.wb.pattern().source.slice(c.span.start, c.span.end);
    const text = this.wb.state().text;
    const ch = text[c.pos];
    const at = `position ${c.pos}${ch !== undefined ? ` (${JSON.stringify(ch)})` : ' (end)'}`;
    if (c.kind === 'start' || c.kind === 'success') return `${STEP_TEXT[c.kind]} ${c.pos}`;
    return `${STEP_TEXT[c.kind]} ${src.length > 40 ? src.slice(0, 40) + '…' : src} at ${at}`;
  });

  constructor() {
    // A new trace starts at its first step.
    effect(() => {
      this.synth.trace();
      this.ui.debugStep.set(0);
    });
  }

  protected go(i: number) {
    const n = this.synth.trace()?.steps.length ?? 0;
    this.step.set(Math.max(0, Math.min(n - 1, i)));
  }

  protected togglePlay() {
    if (this.playing()) return this.stop();
    this.playing.set(true);
    this.timer = setInterval(() => {
      const n = this.synth.trace()?.steps.length ?? 0;
      if (this.step() >= n - 1) return this.stop();
      this.go(this.step() + 1);
    }, 120);
  }

  private stop() {
    clearInterval(this.timer);
    this.playing.set(false);
  }

  ngOnDestroy() {
    this.stop();
  }
}

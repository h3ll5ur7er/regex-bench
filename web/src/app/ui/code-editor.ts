import { afterNextRender, ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, OnDestroy, output, untracked } from '@angular/core';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorSelection, EditorState, Extension, Range, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  DecorationSet,
  drawSelection,
  EditorView,
  highlightSpecialChars,
  hoverTooltip,
  keymap,
  lineNumbers,
  placeholder,
  Tooltip,
  WidgetType,
} from '@codemirror/view';

/** A decorated range in an editor. */
export interface EditorMark {
  from: number;
  to: number;
  class: string;
}

export interface TooltipContent {
  from: number;
  to: number;
  /** Built with text nodes only, never HTML (STRIDE H01). */
  render: () => HTMLElement;
}

const setMarks = StateEffect.define<DecorationSet>();
const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setMarks)) return e.value;
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--text)', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '10px 0' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-3)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 12px', fontSize: '12px' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent) !important' },
  '.cm-placeholder': { color: 'var(--text-3)' },
  '.cm-specialChar': { color: 'var(--err)' },
  '.cm-tooltip': { border: 'none', backgroundColor: 'transparent' },
});

/**
 * A thin Angular wrapper around CodeMirror 6 (docs/Decisions/ADR-007-codemirror.md): value in, changes out,
 * decorations in. Rendering is virtualised by CodeMirror, so large texts stay fast.
 */
@Component({
  selector: 'rb-code-editor',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-height: 0; overflow: hidden; }
    :host ::ng-deep .cm-editor { height: 100%; }
  `,
})
export class CodeEditor implements OnDestroy {
  readonly value = input('');
  readonly marks = input<EditorMark[]>([]);
  readonly readOnly = input(false);
  readonly singleLine = input(false);
  readonly lineNumbers = input(false);
  readonly placeholder = input('');
  readonly label = input('');
  readonly tooltip = input<((pos: number) => TooltipContent | null) | null>(null);
  /** A range to scroll into view, e.g. the current debugger step. */
  readonly reveal = input<number | null>(null);

  readonly changed = output<string>();
  readonly hovered = output<number | null>();
  readonly selected = output<{ from: number; to: number }>();
  readonly focused = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private view?: EditorView;

  constructor() {
    afterNextRender(() => this.create());
    effect(() => {
      const v = this.value();
      const view = this.view;
      if (view && v !== view.state.doc.toString()) {
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: v },
          selection: EditorSelection.cursor(Math.min(sel.head, v.length)),
        });
      }
    });
    effect(() => {
      const marks = this.marks();
      untracked(() => this.applyMarks(marks));
    });
    effect(() => {
      const pos = this.reveal();
      if (pos !== null && this.view) {
        this.view.dispatch({ effects: EditorView.scrollIntoView(Math.min(pos, this.view.state.doc.length), { y: 'center' }) });
      }
    });
  }

  focus() {
    this.view?.focus();
  }

  /** Inserts text at the cursor, replacing the selection. `…` in the text marks where the cursor goes. */
  insert(text: string) {
    const view = this.view;
    if (!view) return;
    const at = text.indexOf('…');
    const clean = text.replace('…', '');
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: clean }, selection: { anchor: from + (at >= 0 ? at : clean.length) } });
    view.focus();
  }

  selectRange(from: number, to: number) {
    this.view?.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    this.view?.focus();
  }

  ngOnDestroy() {
    this.view?.destroy();
  }

  private create() {
    const extensions: Extension[] = [
      theme,
      history(),
      drawSelection(),
      highlightSpecialChars({ addSpecialChars: /[​-‏‪-‮⁦-⁩﻿]/ }),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      marksField,
      EditorView.contentAttributes.of({ 'aria-label': this.label(), spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) this.changed.emit(u.state.doc.toString());
        if (u.selectionSet) {
          const { from, to } = u.state.selection.main;
          this.selected.emit({ from, to });
        }
        if (u.focusChanged && u.view.hasFocus) this.focused.emit();
      }),
      EditorView.domEventHandlers({
        mousemove: (e, view) => {
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
          this.hovered.emit(pos);
        },
        mouseleave: () => this.hovered.emit(null),
      }),
      hoverTooltip((_view, pos): Tooltip | null => {
        const content = this.tooltip()?.(pos);
        if (!content) return null;
        return {
          pos: content.from,
          end: content.to,
          above: true,
          create: () => {
            const dom = content.render();
            dom.classList.add('rb-tooltip');
            return { dom };
          },
        };
      }, { hoverTime: 250 }),
    ];
    if (this.placeholder()) extensions.push(placeholder(this.placeholder()));
    if (this.lineNumbers()) extensions.push(lineNumbers());
    if (this.readOnly()) extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
    if (this.singleLine()) {
      extensions.push(
        EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [tr, { changes: { from: 0, to: tr.newDoc.length, insert: tr.newDoc.toString().replace(/\r?\n/g, '') }, sequential: true }] : tr)),
      );
    } else {
      extensions.push(EditorView.lineWrapping);
    }
    this.view = new EditorView({
      parent: this.host.nativeElement,
      state: EditorState.create({ doc: this.value(), extensions }),
    });
    this.applyMarks(this.marks());
  }

  private applyMarks(marks: EditorMark[]) {
    const view = this.view;
    if (!view) return;
    const len = view.state.doc.length;
    const ranges: Range<Decoration>[] = [];
    for (const m of marks) {
      if (m.from < 0 || m.from > len) continue;
      const to = Math.min(m.to, len);
      if (to > m.from) ranges.push(Decoration.mark({ class: m.class }).range(m.from, to));
      else ranges.push(Decoration.widget({ widget: new EmptyMark(m.class), side: 1 }).range(m.from));
    }
    view.dispatch({ effects: setMarks.of(Decoration.set(ranges, true)) });
  }
}


/** Shows a zero-width match or group as a thin bar. */
class EmptyMark extends WidgetType {
  constructor(private readonly cls: string) {
    super();
  }
  override eq(other: EmptyMark) {
    return other.cls === this.cls;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = this.cls + ' cm-empty-match';
    return s;
  }
}

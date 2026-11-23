import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Inline stroke icons, drawn for this app (no icon font, nothing fetched). 24×24 grid. */
const PATHS: Record<string, string> = {
  share: 'M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8 1 -4 15.4-3.8-1z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  system: 'M3 4h18v12H3zM8 20h8M12 16v4',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  play: 'M6 4l14 8-14 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  prev: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  first: 'M17 18l-6-6 6-6M7 6v12',
  last: 'M7 18l6-6-6-6M17 6v12',
  chevron: 'M6 9l6 6 6-6',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
  zoom: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.35-4.35',
  offline: 'M2 12h4l3-9 6 18 3-9h4',
  logo: 'M5 7h3M11 7h3M17 5v4M15 7h4M5 17l3-6 3 6M7 15h2M14 17c0-2 5-2 5-4s-5-2-5-4',
};

@Component({
  selector: 'rb-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" [attr.stroke-width]="weight()" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="d()" /></svg>`,
  styles: `:host { display: inline-flex; } svg { width: 16px; height: 16px; }`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly weight = input(2);
  protected readonly d = computed(() => PATHS[this.name()] ?? '');
}

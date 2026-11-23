import { inject, Injectable } from '@angular/core';
import { RockumlRenderer } from '@rockuml/angular';

export interface DiagramImage {
  /** A `blob:` URL of the SVG, shown through `<img>` so scripts in it never run (STRIDE H12). */
  url?: string;
  error?: string;
  width?: number;
  height?: number;
}

/**
 * DiagramAccess: `render(notation)` (V4). Wraps rockuml's WebAssembly renderer, which is loaded on first use from
 * the build's own assets (`wasm/rockuml.wasm`); a load failure only affects the diagram (Residuality S08).
 */
@Injectable({ providedIn: 'root' })
export class DiagramAccess {
  private readonly renderer = inject(RockumlRenderer);
  private lastUrl?: string;

  async render(notation: string): Promise<DiagramImage> {
    try {
      const r = await this.renderer.render(notation, { format: 'svg' });
      if (r.isError) return { error: 'The diagram could not be drawn for this pattern.' };
      const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(r.data);
      if (this.lastUrl) URL.revokeObjectURL(this.lastUrl);
      this.lastUrl = URL.createObjectURL(new Blob([r.data], { type: 'image/svg+xml' }));
      return { url: this.lastUrl, width: size ? Number(size[1]) : undefined, height: size ? Number(size[2]) : undefined };
    } catch (e) {
      return { error: `The diagram renderer is unavailable: ${(e as Error).message}` };
    }
  }
}

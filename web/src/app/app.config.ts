import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { provideRockuml } from '@rockuml/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // rockuml.wasm is copied into the build (angular.json assets) and loaded on first diagram.
    provideRockuml({ wasm: 'wasm/rockuml.wasm' }),
    // The desktop app ships its files inside the binary and has no use for (or support of) a service worker.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode() && !('__TAURI_INTERNALS__' in globalThis),
      registrationStrategy: 'registerWhenStable:5000',
    }),
  ],
};

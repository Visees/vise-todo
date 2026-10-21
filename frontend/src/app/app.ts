import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToasterImports } from '@spartan-ng/helm/sonner';
import { ThemeService } from './core/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HlmToasterImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <router-outlet />
    <hlm-toaster position="bottom-center" />
  `,
})
export class App {
  constructor() {
    // Instantiated here so the theme follows system changes from the start.
    inject(ThemeService);
  }
}

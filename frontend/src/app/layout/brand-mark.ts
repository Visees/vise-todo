import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The red mark is the only place the brand colour appears. */
@Component({
  selector: 'app-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex items-center gap-2.5 text-[15px] font-semibold text-foreground' },
  template: `
    <span class="grid size-7 place-items-center rounded-md bg-brand text-sm font-bold text-white" aria-hidden="true">T</span>
    Todo
  `,
})
export class BrandMark {}

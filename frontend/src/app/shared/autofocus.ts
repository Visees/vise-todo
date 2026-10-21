import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Focuses and selects an input as soon as it renders (inline edit). */
@Directive({ selector: 'input[appAutofocus]' })
export class Autofocus {
  constructor() {
    const el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      el.focus();
      el.select();
    });
  }
}

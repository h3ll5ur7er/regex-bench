import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Workbench } from './ui/workbench';

@Component({
  selector: 'app-root',
  imports: [Workbench],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<rb-workbench />',
})
export class App {}

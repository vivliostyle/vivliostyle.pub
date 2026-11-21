import { ref } from 'valtio';

import { SandboxFile } from '../../libs/sandbox/file';
import { $sandbox, $theme } from '../accessors';

export function updateCustomCss(css: string): void {
  $theme.valueOrThrow().customCss = css;
  $sandbox.valueOrThrow().files['style.css'] = ref(
    new SandboxFile('text/css', css),
  );
}

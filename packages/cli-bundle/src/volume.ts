import { fs, vol } from 'memfs';
import { toTreeSync } from 'memfs/lib/print';

vol.fromJSON(__volume__);

vol.fromNestedJSON({
  workdir: {
    'package.json': JSON.stringify({
      name: 'project',
    }),
  },
});

console.log(toTreeSync(fs));

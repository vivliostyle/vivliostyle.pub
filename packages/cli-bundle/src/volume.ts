import { vol } from 'memfs';

vol.fromJSON(__volume__);

vol.fromNestedJSON({
  tmp: {},
  out: {},
  workdir: {
    'package.json': JSON.stringify({
      name: 'project',
    }),
  },
});

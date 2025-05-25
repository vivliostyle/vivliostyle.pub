import { vol } from 'memfs';

vol.fromJSON(__volume__);

vol.fromNestedJSON({
  workdir: {
    'package.json': JSON.stringify({
      name: 'project',
    }),
  },
});

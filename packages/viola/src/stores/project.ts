import { ref } from 'valtio';
import { setupProject } from './actions/setup-project';

export const $project = ref({
  value: setupProject('alpha-v1'),
});

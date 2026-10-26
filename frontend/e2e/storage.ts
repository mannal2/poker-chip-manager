import { LocalRepository } from '../src/features/local-game/storage/repository';
import { defaultSettings } from '../src/game/settings';
export const harness = { repo: new LocalRepository('browser-storage'), defaultSettings };
declare global {
  interface Window {
    storageHarness: typeof harness;
  }
}
window.storageHarness = harness;

import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

/** Folder boundaries from ARCHITECTURE.md "의존 방향"; each entry forbids imports matching `group`. */
function boundary(files, rules) {
  return {
    files,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: rules.map(([group, message]) => ({ group, message })) },
      ],
    },
  };
}
const featureFolders = ['**/features', '**/features/**'];
export default ts.config(
  {
    ignores: ['dist/**', '.cache/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
  },
  boundary(
    ['src/game/**'],
    [
      [
        [...featureFolders, '**/shared/**', '**/app/**', 'react', 'react-dom', 'react/**', 'idb'],
        'game/은 순수 규칙이다. UI·저장소·기능 폴더를 import하지 않는다.',
      ],
    ],
  ),
  boundary(
    ['src/shared/**'],
    [
      [
        [...featureFolders, '**/game/**', '**/app/**'],
        'shared/는 범용 코드다. 게임 규칙·기능 폴더·앱 진입점을 import하지 않는다.',
      ],
    ],
  ),
  boundary(
    ['src/features/gameplay/**'],
    [
      [
        [
          '**/local-game',
          '**/local-game/**',
          '**/online-game',
          '**/online-game/**',
          '**/pwa',
          '**/pwa/**',
        ],
        'gameplay/는 모드 공통이다. 로컬·온라인 운영과 PWA는 GameSession·props로 받는다.',
      ],
    ],
  ),
  boundary(
    ['src/features/pwa/**'],
    [
      [
        ['**/local-game', '**/local-game/**', '**/online-game', '**/online-game/**'],
        'pwa/는 로컬 세션·저장소를 import하지 않고 콜백으로 받는다.',
      ],
    ],
  ),
  boundary(
    ['src/features/local-game/**'],
    [[['**/online-game', '**/online-game/**'], '로컬과 온라인 모드는 서로 import하지 않는다.']],
  ),
  boundary(
    ['src/features/online-game/**'],
    [[['**/local-game', '**/local-game/**'], '로컬과 온라인 모드는 서로 import하지 않는다.']],
  ),
);

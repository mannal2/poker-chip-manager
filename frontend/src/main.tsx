import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installZoomPolicy } from './shared/browser/zoomPolicy';
installZoomPolicy();
createRoot(document.getElementById('root')!).render(<App />);

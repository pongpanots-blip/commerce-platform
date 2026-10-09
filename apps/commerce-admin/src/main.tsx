import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import { enablePageGuides } from '@cp/ui';
import './styles.css';
import App from './app/app';

enablePageGuides();

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

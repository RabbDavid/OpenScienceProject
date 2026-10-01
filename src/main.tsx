import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/source-serif-4';
import '@fontsource/dm-mono/latin-400.css';
import '@fontsource/dm-mono/latin-500.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

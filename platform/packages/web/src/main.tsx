import React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider } from './lib/auth.tsx';
import { App } from './App.tsx';
import './styles/tokens.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
);

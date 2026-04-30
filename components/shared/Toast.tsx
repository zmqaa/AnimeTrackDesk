"use client";

import { Toaster } from 'react-hot-toast';

export default function Toast() {
  return (
    <Toaster
      position="top-center"
      gutter={8}
      toastOptions={{
        duration: 3000,
        style: {
          background: 'rgba(14, 21, 19, 0.95)',
          backdropFilter: 'blur(20px)',
          color: '#f5f7f4',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          fontSize: '13px',
          padding: '12px 16px',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.4)',
          maxWidth: '420px',
        },
        success: {
          iconTheme: {
            primary: '#56d39c',
            secondary: '#07110f',
          },
        },
        error: {
          iconTheme: {
            primary: '#f87171',
            secondary: '#07110f',
          },
          duration: 4000,
        },
      }}
    />
  );
}

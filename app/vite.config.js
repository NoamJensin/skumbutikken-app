import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'sb-monogram.png'],
      manifest: {
        name: 'Skumbutikken',
        short_name: 'Skumbutikken',
        description: 'Intern ordre- og værkstedsapp for Skumbutikken',
        lang: 'da',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#eef5fb',
        theme_color: '#d6e8f6',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Kun app-skallen caches. Forretningsdata caches aldrig af service workeren.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: []
      }
    })
  ],
  build: { target: 'es2019', chunkSizeWarningLimit: 900 }
})

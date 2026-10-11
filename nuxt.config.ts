// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // Pure client-side SPA — no server runtime needed for Cloudflare Pages free tier.
  ssr: false,

  compatibilityDate: '2025-01-01',

  devtools: { enabled: false },

  modules: ['@nuxtjs/tailwindcss'],

  app: {
    head: {
      title: 'WordMorph | Versus',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'WordMorph | Versus — a 2-player head-to-head word duel. Mutate a word one letter at a time to outlast your rival.'
        },
        { name: 'author', content: '@MSTRIRVING' },
        { name: 'creator', content: '@MSTRIRVING' },
        { name: 'theme-color', content: '#0f0a1e' },
        {
          name: 'keywords',
          content:
            'word game, word morph, versus, 2 player, multiplayer, word duel, puzzle'
        },

        // Open Graph (Facebook, LinkedIn, Discord, etc.)
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: 'WordMorph | Versus' },
        { property: 'og:title', content: 'WordMorph | Versus' },
        {
          property: 'og:description',
          content:
            'A high-stakes 2-player word duel. Change one letter at a time, beat the 15-second clock, and outlast your rival. Built by @MSTRIRVING.'
        },
        { property: 'og:image', content: '/og-image.svg' },
        { property: 'og:url', content: 'https://word-morph-versus.pages.dev' },

        // Twitter / X Card
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:site', content: '@MSTRIRVING' },
        { name: 'twitter:creator', content: '@MSTRIRVING' },
        { name: 'twitter:title', content: 'WordMorph | Versus' },
        {
          name: 'twitter:description',
          content:
            'A high-stakes 2-player word duel. Change one letter at a time, beat the 15-second clock, and outlast your rival. Built by @MSTRIRVING.'
        },
        { name: 'twitter:image', content: '/og-image.svg' }
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }]
    }
  },

  // Static generation output. `nuxi generate` writes to .output/public,
  // which is what Cloudflare Pages serves.
  nitro: {
    preset: 'static'
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      // Base URL of the Cloudflare Worker (no trailing slash).
      // Override at build/deploy time with NUXT_PUBLIC_WS_URL.
      // Local dev default points at `wrangler dev`.
      wsUrl: 'http://127.0.0.1:8787'
    }
  }
})

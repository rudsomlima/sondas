/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/telegram-test': ['./public/fonts/Assistant.ttf'],
    '/api/telegram-notify': ['./public/fonts/Assistant.ttf'],
    '/api/poll': ['./public/fonts/Assistant.ttf'],
  },
}

module.exports = nextConfig

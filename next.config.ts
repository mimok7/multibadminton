import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // 성능 최적화 설정
  experimental: {
    optimizePackageImports: ['@supabase/supabase-js', 'lucide-react'],
  },

  eslint: {
    ignoreDuringBuilds: true,
  },
  
  typescript: {
    ignoreBuildErrors: true,
  },
  
  // 컴파일 최적화
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  
  // 이미지 최적화
  images: {
    formats: ['image/webp', 'image/avif'],
    minimumCacheTTL: 60,
  },
  
  // 압축 활성화
  compress: true,
  
  // 정적 파일 최적화
  poweredByHeader: false,
}

export default nextConfig

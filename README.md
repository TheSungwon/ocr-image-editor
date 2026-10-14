npm install @capacitor/core @capacitor/android
npm install -D @capacitor/cli
npx cap init


next.config.ts에서

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;



npm run build
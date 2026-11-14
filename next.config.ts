import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["sharp", "@libsql/client", "libsql", "bullmq", "ioredis"],
};

export default config;

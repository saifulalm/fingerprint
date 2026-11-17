// Single shared Prisma client instance — avoids multiple connections causing SQLite lock contention
// NOTE: @prisma/client ESM entry fails on this Windows/ESM setup, so we import the
// generated client directly from .prisma/client which works correctly.
import { PrismaClient } from '../node_modules/.prisma/client/index.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

export default prisma;

import { PrismaClient } from '@prisma/client';

// Declare global prisma variable to prevent multiple instances in development
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

// Initialize Prisma Client with connection pooling and error handling
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    errorFormat: 'minimal',
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });
};

// Ensure single instance of Prisma Client
const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

// Initial connection with retry logic
let connectionAttempts = 0;
const maxAttempts = 3;
const retryDelay = 5000; // 5 seconds

const connectWithRetry = async () => {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
  } catch (error) {
    connectionAttempts++;
    console.error(`❌ Database connection attempt ${connectionAttempts} failed:`, error);

    if (connectionAttempts < maxAttempts) {
      console.log(`⏳ Retrying in ${retryDelay / 1000} seconds...`);
      setTimeout(connectWithRetry, retryDelay);
    } else {
      console.error('❌ Failed to connect to database after maximum attempts');
      // Don't exit immediately - let the app run and retry on requests
      // process.exit(1);
    }
  }
};

// Start connection
connectWithRetry();

// Graceful shutdown
process.on('beforeExit', async () => {
  console.log('🔄 Disconnecting from database...');
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  console.log('🔄 Graceful shutdown - disconnecting from database...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('🔄 Graceful shutdown - disconnecting from database...');
  await prisma.$disconnect();
  process.exit(0);
});

// Connection health check utility
export const checkDatabaseConnection = async (): Promise<boolean> => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    console.error('Database connection check failed:', error);
    return false;
  }
};

// Utility to safely execute database operations with retry
export const withDatabaseRetry = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> => {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Check if it's a connection-related error
      if (error.code === 'P2037' || error.message?.includes('connection')) {
        console.warn(`Database operation attempt ${attempt}/${maxRetries} failed:`, error.message);

        if (attempt < maxRetries) {
          // Wait before retry with exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      // For non-connection errors, throw immediately
      throw error;
    }
  }

  throw lastError!;
};

export default prisma;

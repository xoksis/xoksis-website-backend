import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
// Gracefully close DB connections on process exit
// Prevents connection pool exhaustion on restart/crash
const shutdown = async () => {
    await prisma.$disconnect();
    process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
export default prisma;

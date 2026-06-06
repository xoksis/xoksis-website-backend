import prisma from './src/config/prisma.ts';

async function makeAdmin(email) {
    try {
        const user = await prisma.user.update({
            where: { email },
            data: { role: 'ADMIN' }
        });
        console.log(`User ${user.email} is now an ADMIN.`);
    } catch (e) {
        console.error('Error making user admin:', e.message);
    } finally {
        await prisma.$disconnect();
    }
}

const email = process.argv[2];
if (email) {
    makeAdmin(email);
} else {
    console.log('Please provide an email address.');
}

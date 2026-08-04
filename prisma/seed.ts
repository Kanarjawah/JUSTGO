import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Password123!', 12);

  const admin = await prisma.user.upsert({
    where: { phone: '+231770000001' },
    update: {},
    create: {
      phone: '+231770000001',
      email: 'admin@justgo.lr',
      passwordHash,
      firstName: 'Amina',
      lastName: 'Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
      adminProfile: { create: { title: 'Platform Administrator' } },
    },
  });

  const customer = await prisma.user.upsert({
    where: { phone: '+231770000002' },
    update: {},
    create: {
      phone: '+231770000002',
      email: 'customer@justgo.lr',
      passwordHash,
      firstName: 'Comfort',
      lastName: 'Kollie',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      customerProfile: { create: {} },
    },
    include: { customerProfile: true },
  });

  const driver = await prisma.user.upsert({
    where: { phone: '+231770000003' },
    update: {},
    create: {
      phone: '+231770000003',
      email: 'driver@justgo.lr',
      passwordHash,
      firstName: 'Emmanuel',
      lastName: 'Driver',
      role: 'DRIVER',
      status: 'ACTIVE',
      driverProfile: {
        create: {
          applicationStatus: 'APPROVED',
          vehicleType: 'Taxi',
          licenseNumber: 'LR-DRV-1001',
          availability: { create: { status: 'ONLINE' } },
        },
      },
    },
    include: { driverProfile: true },
  });

  const merchant = await prisma.user.upsert({
    where: { phone: '+231770000004' },
    update: {},
    create: {
      phone: '+231770000004',
      email: 'merchant@justgo.lr',
      passwordHash,
      firstName: 'Sarah',
      lastName: 'Merchant',
      role: 'MERCHANT',
      status: 'ACTIVE',
      merchantProfile: {
        create: {
          applicationStatus: 'APPROVED',
          businessName: "Cee's Kitchen",
          store: {
            create: {
              name: "Cee's Kitchen",
              description: 'Jollof & Grill',
              address: 'Sinkor, Monrovia',
              preparationMins: 25,
              products: {
                create: [
                  {
                    name: 'Jollof Rice',
                    description: 'Party-size plate',
                    priceCents: 45000,
                    available: true,
                    prepMins: 20,
                  },
                  {
                    name: 'Grilled Chicken',
                    priceCents: 55000,
                    available: true,
                    prepMins: 25,
                  },
                ],
              },
            },
          },
        },
      },
    },
    include: { merchantProfile: { include: { store: true } } },
  });

  await prisma.systemSetting.upsert({
    where: { key: 'customer_fee_cents' },
    update: { value: '100' },
    create: { key: 'customer_fee_cents', value: '100' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'driver_fee_cents' },
    update: { value: '100' },
    create: { key: 'driver_fee_cents', value: '100' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'cash_payments' },
    update: { value: 'disabled' },
    create: { key: 'cash_payments', value: 'disabled' },
  });

  // Sample accepted ride for driver workflow demos
  if (customer.customerProfile && driver.driverProfile) {
    const existing = await prisma.rideRequest.findFirst({
      where: { requestNumber: 'RIDE-DEMO-001' },
    });
    if (!existing) {
      await prisma.rideRequest.create({
        data: {
          requestNumber: 'RIDE-DEMO-001',
          customerId: customer.customerProfile.id,
          serviceType: 'RIDE',
          pickup: 'Broad Street',
          destination: 'Sinkor',
          pickupDate: '2026-08-02',
          pickupTime: '16:30',
          riderCount: 1,
          customerPhone: customer.phone,
          estimatedFareCents: 35000,
          paymentMethod: 'MTN_MOMO',
          safetyConsent: true,
          adminStatus: 'ACCEPTED',
          paymentStatus: 'PAID',
          distanceKm: 5.4,
          durationMin: 18,
          instructions: 'Call on arrival',
          assignment: {
            create: {
              driverId: driver.driverProfile.id,
              active: true,
            },
          },
          payment: {
            create: {
              method: 'MTN_MOMO',
              status: 'PAID',
              amountCents: 36850,
            },
          },
          taxes: { create: { amountCents: 1750 } },
        },
      });
    }
  }

  // Sample store order for merchant
  if (customer.customerProfile && merchant.merchantProfile?.store) {
    const existingOrder = await prisma.order.findFirst({
      where: { requestNumber: 'ORD-DEMO-001' },
    });
    if (!existingOrder) {
      const delivery = await prisma.deliveryRequest.create({
        data: {
          requestNumber: 'DEL-DEMO-001',
          customerId: customer.customerProfile.id,
          serviceType: 'FOOD_DELIVERY',
          pickup: "Cee's Kitchen",
          destination: 'Paynesville',
          estimatedEarnCents: 42000,
          paymentStatus: 'PAID',
          adminStatus: 'ACCEPTED',
          merchantPrepStatus: 'ACCEPTED',
          distanceKm: 8.2,
          durationMin: 30,
          instructions: 'Leave with security',
        },
      });
      await prisma.order.create({
        data: {
          requestNumber: 'ORD-DEMO-001',
          customerId: customer.customerProfile.id,
          storeId: merchant.merchantProfile.store.id,
          deliveryRequestId: delivery.id,
          subtotalCents: 45000,
          totalCents: 49350,
          paymentStatus: 'PAID',
          prepEstimateMin: 25,
          merchantPrepStatus: 'ACCEPTED',
          items: {
            create: [{ name: 'Jollof Rice', quantity: 1, priceCents: 45000 }],
          },
        },
      });
    }
  }

  console.log('Seeded JUSTGO demo users:');
  console.log('  Admin    +231770000001 / Password123!');
  console.log('  Customer +231770000002 / Password123!');
  console.log('  Driver   +231770000003 / Password123!');
  console.log('  Merchant +231770000004 / Password123!');
  console.log(`  Admin id: ${admin.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

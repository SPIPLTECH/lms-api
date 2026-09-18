const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

module.exports = prisma;
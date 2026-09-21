const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.content.update({ where: { id: "ytembed_verify_c1" }, data: { videoUrl: process.argv[2] } })
  .then(c => { console.log("c1 ->", c.videoUrl); return p.$disconnect(); })
  .catch(e => { console.log("ERR", e.message.slice(0,90)); process.exit(1); });

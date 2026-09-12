const jwt = require("jsonwebtoken");
const prisma = require("../config/database");

const socketAuth = async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error("Authentication required."));
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_ACCESS_SECRET ||
            process.env.JWT_SECRET
        );

        const user = await prisma.user.findUnique({
            where: {
                id: decoded.id,
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                status: true,
            },
        });

        if (!user) {
            return next(new Error("User not found."));
        }

        if (user.status !== "ACTIVE") {
            return next(
                new Error("User account is inactive.")
            );
        }

        socket.user = user;

        next();
    } catch (error) {
        next(new Error("Invalid token."));
    }
};

module.exports = socketAuth;
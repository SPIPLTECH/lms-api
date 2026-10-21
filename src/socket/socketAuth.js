const jwt = require("jsonwebtoken");
const prisma = require("../config/database");
const sessionService = require("../modules/sessions/session.service");

/**
 * Socket handshakes pass the same gate as REST requests: a signed access
 * token naming an ACTIVE, unexpired session, presented from the device the
 * session is bound to (`auth.deviceKey`), for an ACTIVE account. The socket
 * joins `session_<id>` so ending the session closes it
 * (session.service → socket/index.js disconnectSessions).
 */
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

        if (!decoded.sid) {
            return next(new Error("Invalid token."));
        }

        await sessionService.validateAccess({
            sessionId: decoded.sid,
            userId: decoded.id,
            deviceKey: socket.handshake.auth?.deviceKey,
        });

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
        socket.sessionId = decoded.sid;

        next();
    } catch (error) {
        next(new Error("Invalid token."));
    }
};

module.exports = socketAuth;

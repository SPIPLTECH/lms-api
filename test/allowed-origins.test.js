/**
 * The API has two CORS layers — Express (src/app.js) and Socket.io
 * (src/socket/index.js) — and they used to be configured from different
 * environment variables with different defaults. Serving the app over the LAN
 * hit that split head on: REST calls from http://192.168.x.x:3000 were accepted
 * while the socket handshake from the very same page was rejected, so chat,
 * presence and notifications were dead on every device except the host PC.
 *
 * Both now read src/config/allowedOrigins.js. These tests pin the three things
 * that module has to get right:
 *
 *   1. LAN origins are accepted, without any address being pinned in .env.
 *   2. Public origins are NOT accepted just because LAN access is on.
 *   3. A caller with no Origin at all (Razorpay webhooks, the Next.js route
 *      handlers' server-side fetch, curl) is never rejected.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    isAllowedOrigin,
    lanOriginsAllowed,
    corsOriginDelegate,
} = require("../src/config/allowedOrigins");

const ENV_KEYS = [
    "CORS_ALLOWED_ORIGINS",
    "FRONTEND_URL",
    "ALLOW_LAN_ORIGINS",
    "NODE_ENV",
];

/** Runs `fn` with exactly the given env vars set, restoring the real ones after. */
const withEnv = (env, fn) => {
    const saved = {};
    ENV_KEYS.forEach((key) => {
        saved[key] = process.env[key];
        delete process.env[key];
    });
    Object.entries(env).forEach(([key, value]) => {
        process.env[key] = value;
    });

    try {
        return fn();
    } finally {
        ENV_KEYS.forEach((key) => {
            if (saved[key] === undefined) delete process.env[key];
            else process.env[key] = saved[key];
        });
    }
};

test("accepts LAN origins across all three private ranges", () => {
    withEnv({ ALLOW_LAN_ORIGINS: "true" }, () => {
        [
            "http://192.168.1.105:3000",
            "http://192.168.0.7:3000",
            "http://10.0.0.42:3000",
            "http://10.255.255.254:3000",
            "http://172.16.5.9:3000",
            "http://172.31.0.1:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ].forEach((origin) => {
            assert.equal(isAllowedOrigin(origin), true, `expected ${origin} to be allowed`);
        });
    });
});

test("does not accept public addresses that merely look nearby", () => {
    withEnv({ ALLOW_LAN_ORIGINS: "true" }, () => {
        [
            // Just outside 172.16.0.0/12 on either side — these are public.
            "http://172.15.0.1:3000",
            "http://172.32.0.1:3000",
            // 192.169/11.x are public ranges, not RFC1918.
            "http://192.169.1.1:3000",
            "http://11.0.0.1:3000",
            // A hostname that merely embeds a private-looking string.
            "http://192.168.1.105.evil.example",
            "https://attacker.example",
        ].forEach((origin) => {
            assert.equal(isAllowedOrigin(origin), false, `expected ${origin} to be rejected`);
        });
    });
});

test("LAN acceptance is off in production and on outside it", () => {
    withEnv({ NODE_ENV: "production" }, () => {
        assert.equal(lanOriginsAllowed(), false);
        assert.equal(isAllowedOrigin("http://192.168.1.105:3000"), false);
    });

    withEnv({ NODE_ENV: "development" }, () => {
        assert.equal(lanOriginsAllowed(), true);
        assert.equal(isAllowedOrigin("http://192.168.1.105:3000"), true);
    });

    // An explicit flag overrides the NODE_ENV default in both directions.
    withEnv({ NODE_ENV: "production", ALLOW_LAN_ORIGINS: "true" }, () => {
        assert.equal(isAllowedOrigin("http://192.168.1.105:3000"), true);
    });
    withEnv({ NODE_ENV: "development", ALLOW_LAN_ORIGINS: "false" }, () => {
        assert.equal(isAllowedOrigin("http://192.168.1.105:3000"), false);
    });
});

test("honours both CORS_ALLOWED_ORIGINS and FRONTEND_URL, comma-separated", () => {
    withEnv(
        {
            ALLOW_LAN_ORIGINS: "false",
            CORS_ALLOWED_ORIGINS: "https://a.example, https://b.example",
            FRONTEND_URL: "https://c.example",
        },
        () => {
            assert.equal(isAllowedOrigin("https://a.example"), true);
            assert.equal(isAllowedOrigin("https://b.example"), true);
            assert.equal(isAllowedOrigin("https://c.example"), true);
            assert.equal(isAllowedOrigin("https://d.example"), false);
        }
    );
});

test("keeps the origins the socket layer shipped with", () => {
    withEnv({ ALLOW_LAN_ORIGINS: "false" }, () => {
        assert.equal(isAllowedOrigin("http://localhost:3000"), true);
        assert.equal(isAllowedOrigin("https://lms-web-demo.vercel.app"), true);
    });
});

test("a request with no Origin is always allowed", () => {
    // Webhooks, server-to-server fetches and curl send no Origin header. CORS
    // has nothing to protect there, and rejecting them would break the Razorpay
    // webhook and the frontend's upload proxy.
    withEnv({ ALLOW_LAN_ORIGINS: "false", NODE_ENV: "production" }, () => {
        assert.equal(isAllowedOrigin(undefined), true);
        assert.equal(isAllowedOrigin(""), true);
    });
});

test("the cors delegate reports decisions without erroring", () => {
    withEnv({ ALLOW_LAN_ORIGINS: "true" }, () => {
        const calls = [];
        corsOriginDelegate("http://192.168.1.105:3000", (err, allow) =>
            calls.push([err, allow])
        );
        corsOriginDelegate("https://attacker.example", (err, allow) =>
            calls.push([err, allow])
        );

        assert.deepEqual(calls, [
            [null, true],
            [null, false],
        ]);
    });
});

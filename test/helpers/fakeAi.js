/**
 * A stand-in for the Python AI service, over real HTTP on loopback, so the HTTP adapter
 * and its response checks run for real. A test frame is a JPEG signature followed by a
 * tag saying what the "AI" should see. No model runs here. Real-model runs are separate.
 */
const http = require("http");

const TOKEN = "fake-ai-token-for-tests-only-0123456789";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const MODEL = { name: "fake", version: "1", sha256: "fakemodelsha", scoreThreshold: 0.5 };
const box = { x: 0, y: 0, width: 10, height: 10 };

const frame = (tag) => Buffer.concat([JPEG, Buffer.from(tag)]);

const vector = (position) => Array.from({ length: 128 }, (_, i) => (i === position ? 1 : 0));

const SCENES = {
  ONE: { faces: [0.95], embedding: vector(0) },
  LOW_FACE: { faces: [0.4], embedding: vector(0) },
  OTHER: { faces: [0.95], embedding: vector(1) },
  NONE: { faces: [] },
  TWO: { faces: [0.95, 0.9] },
  PHONE: { faces: [0.95], embedding: vector(0), objects: [{ label: "cell phone", score: 0.9, box }] },
  PHONE_MID: { faces: [0.95], embedding: vector(0), objects: [{ label: "cell phone", score: 0.65, box }] },
  PHONE_BORDERLINE: { faces: [0.95], embedding: vector(0), objects: [{ label: "cell phone", score: 0.45, box }] },
  AWAY: { faces: [0.95], embedding: vector(0), pose: { yawDeg: 50, pitchDeg: 0, rollDeg: 0, reliable: true } },
  AWAY_LOW_SCORE: { faces: [0.45], embedding: vector(0), pose: { yawDeg: 50, pitchDeg: 0, rollDeg: 0, reliable: true } },
  AWAY_UNRELIABLE: { faces: [0.95], embedding: vector(0), pose: { yawDeg: 80, pitchDeg: 0, rollDeg: -85, reliable: false } },
};

function respond(tag, identityRequested) {
  const scene = SCENES[tag] || SCENES.ONE;
  const count = scene.faces.length;
  const pose = scene.pose || { yawDeg: 0, pitchDeg: 0, rollDeg: 0, reliable: true };
  return {
    apiVersion: "v1",
    status: "OK",
    faces: {
      count,
      classification: count === 0 ? "NO_FACE" : count === 1 ? "ONE_FACE" : "MULTIPLE_FACES",
      items: scene.faces.map((score) => ({ score, box, headPose: pose })),
      inferenceMs: 1,
      model: MODEL,
    },
    objects: { status: "OK", labels: ["cell phone"], items: scene.objects || [], inferenceMs: 1, model: MODEL },
    ...(identityRequested
      ? { identity: count === 1 ? { status: "OK", embedding: scene.embedding, inferenceMs: 1, model: MODEL } : { status: "NOT_ONE_FACE", embedding: null, inferenceMs: 0, model: MODEL } }
      : {}),
    totalMs: 2,
  };
}

async function startFakeAi() {
  const state = { down: false, calls: 0, identityCalls: 0, delayMs: 0 };
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { code: "UNAUTHORIZED" });
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/v1/health") {
      if (state.down) return send(503, { code: "MODEL_NOT_LOADED" });
      return send(200, { modelLoaded: true, objectModelLoaded: true, identityModelLoaded: true, workers: 2 });
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      state.calls += 1;
      const identity = url.searchParams.get("identity") === "true";
      if (identity) state.identityCalls += 1;
      if (state.down) return send(503, { code: "MODEL_NOT_LOADED" });
      const tag = Buffer.concat(chunks).subarray(JPEG.length).toString();
      setTimeout(() => send(200, respond(tag, identity)), state.delayMs);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.AI_SERVICE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AI_SERVICE_TOKEN = TOKEN;
  return {
    state,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { frame, startFakeAi };

import http from "node:http";
import { spawn } from "node:child_process";

const STREAM_URL = process.env.RELYY_STREAM_INGEST_URL ?? "http://127.0.0.1:8177/ingest";
const BITRATE = process.env.RELYY_STREAM_BITRATE ?? "128k";
const SAMPLE_RATE = process.env.RELYY_STREAM_SAMPLE_RATE ?? "44100";
const CHANNELS = process.env.RELYY_STREAM_CHANNELS ?? "2";

const ffmpegPath = process.env.FFMPEG_BIN ?? "ffmpeg";

const args = [
  "-hide_banner",
  "-loglevel",
  "warning",
  "-re",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=880:sample_rate=44100",
  "-ac",
  CHANNELS,
  "-ar",
  SAMPLE_RATE,
  "-b:a",
  BITRATE,
  "-f",
  "mp3",
  "pipe:1",
];

const targetUrl = new URL(STREAM_URL);

const req = http.request(
  {
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port,
    path: targetUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Transfer-Encoding": "chunked",
      Connection: "keep-alive",
    },
  },
  (res) => {
    let body = "";
    res.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    res.on("end", () => {
      console.log(`[ingest] server response ${res.statusCode}: ${body}`);
    });
  },
);

req.on("error", (error) => {
  console.error(`[ingest] request error: ${error.message}`);
});

console.log(`[ingest] spawning ${ffmpegPath} ${args.join(" ")}`);
console.log(`[ingest] streaming to ${STREAM_URL}`);

const ffmpeg = spawn(ffmpegPath, args, {
  stdio: ["ignore", "pipe", "pipe"],
});

ffmpeg.stdout.on("data", (chunk) => {
  const ok = req.write(chunk);
  if (!ok) {
    ffmpeg.stdout.pause();
    req.once("drain", () => {
      ffmpeg.stdout.resume();
    });
  }
});

ffmpeg.stderr.on("data", (chunk) => {
  const line = chunk.toString("utf8").trim();
  if (line) {
    console.log(`[ffmpeg] ${line}`);
  }
});

ffmpeg.on("close", (code) => {
  req.end();
  console.log(`[ingest] ffmpeg exited with code ${code ?? "unknown"}`);
});

process.on("SIGINT", () => {
  ffmpeg.kill("SIGINT");
  req.end();
});

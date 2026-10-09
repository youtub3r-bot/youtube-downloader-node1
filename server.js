const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// yt-dlp executable (supports cloud environment PATH or local Windows fallback)
const defaultWinYtdlp =
  "C:\\Users\\Jaidev\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python313\\Scripts\\yt-dlp.exe";
const YTDLP =
  process.env.YTDLP_PATH ||
  (process.platform === "win32" && fs.existsSync(defaultWinYtdlp)
    ? defaultWinYtdlp
    : "yt-dlp");

const DOWNLOAD_ROOT = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOAD_ROOT)) {
  fs.mkdirSync(DOWNLOAD_ROOT, { recursive: true });
}

// Auto-generate cookies.txt from environment variable if provided
if (
  process.env.YTDLP_COOKIES &&
  !fs.existsSync(path.join(__dirname, "cookies.txt"))
) {
  try {
    fs.writeFileSync(
      path.join(__dirname, "cookies.txt"),
      process.env.YTDLP_COOKIES,
      "utf8"
    );
    console.log("Loaded YouTube cookies from YTDLP_COOKIES environment variable.");
  } catch (err) {
    console.error("Failed to write cookies.txt:", err.message);
  }
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const jobs = new Map();

function safeName(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function createJob() {
  const id =
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8);

  const folder = path.join(DOWNLOAD_ROOT, id);

  fs.mkdirSync(folder, { recursive: true });

  jobs.set(id, {
    id,
    status: "starting",
    progress: 0,
    filename: null,
    error: null,
    process: null,
    folder,
    createdAt: Date.now(),
  });

  return jobs.get(id);
}

function findDownloadedFile(folder, format) {
  if (!fs.existsSync(folder)) return null;

  const files = fs.readdirSync(folder);

  const extension = format === "mp3" ? ".mp3" : ".mp4";

  const file = files.find((f) => f.toLowerCase().endsWith(extension));

  return file || null;
}

function cleanupOldJobs() {
  const now = Date.now();

  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > 60 * 60 * 1000) {
      try {
        if (job.process) {
          job.process.kill();
        }
      } catch {}

      try {
        fs.rmSync(job.folder, {
          recursive: true,
          force: true,
        });
      } catch {}

      jobs.delete(id);
    }
  }
}

setInterval(cleanupOldJobs, 10 * 60 * 1000);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "YouTube Downloader",
    jobs: jobs.size,
  });
});

app.post("/download", (req, res) => {
  const { url, format, quality } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({
      error: "Please enter a YouTube URL.",
    });
  }

  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return res.status(400).json({
      error: "Please enter a valid YouTube URL.",
    });
  }

  const selectedFormat = format === "mp4" ? "mp4" : "mp3";

  const allowedMP3 = ["128", "192", "256", "320"];
  const allowedMP4 = ["360", "480", "720", "1080"];

  let selectedQuality;

  if (selectedFormat === "mp3") {
    selectedQuality = allowedMP3.includes(String(quality))
      ? String(quality)
      : "192";
  } else {
    selectedQuality = allowedMP4.includes(String(quality))
      ? String(quality)
      : "720";
  }

  const job = createJob();

  const outputTemplate = path.join(
    job.folder,
    "%(title)s.%(ext)s"
  );

  let args = [
    "--newline",
    "--no-playlist",
    "--restrict-filenames",
    "--progress",
    "--js-runtimes",
    "deno,node",
    "--extractor-args",
    "youtube:player_client=android,web,tv,ios",
    "--geo-bypass",
    "--geo-bypass-country",
    process.env.GEO_BYPASS_COUNTRY || "IN",
  ];

  // Optional proxy support
  if (process.env.YTDLP_PROXY || process.env.HTTP_PROXY) {
    args.push("--proxy", process.env.YTDLP_PROXY || process.env.HTTP_PROXY);
  }

  // Check for cookies.txt in root directory or custom path
  const cookiesPath =
    process.env.COOKIES_PATH || path.join(__dirname, "cookies.txt");
  if (fs.existsSync(cookiesPath)) {
    args.push("--cookies", cookiesPath);
  }

  if (selectedFormat === "mp3") {
    args.push(
      "-f",
      "bestaudio/best",
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      `${selectedQuality}K`,
      "-o",
      outputTemplate
    );
  } else {
    args.push(
      "-f",
      `bestvideo[height<=${selectedQuality}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${selectedQuality}]+bestaudio/best[height<=${selectedQuality}]/best`,
      "--merge-output-format",
      "mp4",
      "-o",
      outputTemplate
    );
  }

  args.push(url);

  const child = spawn(YTDLP, args, {
    shell: false,
    windowsHide: true,
  });

  job.process = child;
  job.status = "downloading";

  let stderr = "";

  child.stdout.on("data", (data) => {
    const output = data.toString();

    // Example:
    // [download]  25.4% of 10.50MiB at ...
    const match = output.match(
      /\[download\]\s+(\d+(?:\.\d+)?)%/
    );

    if (match) {
      job.progress = Math.min(
        100,
        parseFloat(match[1])
      );
    }

    // Sometimes yt-dlp reports destination/title
    const destinationMatch = output.match(
      /Destination:\s+(.+)/
    );

    if (destinationMatch) {
      job.filename = path.basename(
        destinationMatch[1].trim()
      );
    }
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("error", (error) => {
    job.status = "error";
    job.error = error.message;
    job.process = null;
  });

  child.on("close", (code) => {
    job.process = null;

    if (code !== 0) {
      job.status = "error";
      job.error =
        stderr.trim() ||
        `yt-dlp exited with code ${code}`;

      return;
    }

    const file = findDownloadedFile(
      job.folder,
      selectedFormat
    );

    if (!file) {
      job.status = "error";
      job.error = "Download completed but output file was not found.";
      return;
    }

    job.filename = file;
    job.progress = 100;
    job.status = "completed";
  });

  res.json({
    success: true,
    jobId: job.id,
  });
});

app.get("/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      error: "Job not found.",
    });
  }

  res.json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    filename: job.filename,
    error: job.error,
    downloadUrl:
      job.status === "completed"
        ? `/download/${job.id}/${encodeURIComponent(
            job.filename
          )}`
        : null,
  });
});

app.post("/cancel/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job) {
    return res.status(404).json({
      error: "Job not found.",
    });
  }

  if (
    job.status === "completed" ||
    job.status === "error" ||
    job.status === "cancelled"
  ) {
    return res.json({
      success: false,
      message: "Job is already finished.",
    });
  }

  try {
    if (job.process) {
      job.process.kill();
    }
  } catch {}

  job.status = "cancelled";
  job.error = "Download cancelled by user.";
  job.process = null;

  try {
    fs.rmSync(job.folder, {
      recursive: true,
      force: true,
    });
  } catch {}

  res.json({
    success: true,
  });
});

app.get("/download/:jobId/:filename", (req, res) => {
  const job = jobs.get(req.params.jobId);

  if (!job || !job.filename) {
    return res.status(404).send("File not found.");
  }

  const requested = path.basename(
    decodeURIComponent(req.params.filename)
  );

  if (requested !== path.basename(job.filename)) {
    return res.status(403).send("Access denied.");
  }

  const filePath = path.join(
    job.folder,
    job.filename
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }

  res.download(filePath, job.filename);
});

app.listen(PORT, () => {
  console.log("");
  console.log("=================================");
  console.log(" YouTube Downloader");
  console.log("=================================");
  console.log(` http://localhost:${PORT}`);
  console.log("");
});
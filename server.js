const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve yt-dlp executable (supports cPanel bundled binary, env var, system PATH, or local Windows)
function resolveYtdlp() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }
  const bundledLinux = path.join(__dirname, "yt-dlp");
  if (process.platform !== "win32" && fs.existsSync(bundledLinux)) {
    try {
      fs.chmodSync(bundledLinux, 0o755);
    } catch {}
    return bundledLinux;
  }
  const bundledLinuxBin = path.join(__dirname, "bin", "yt-dlp");
  if (process.platform !== "win32" && fs.existsSync(bundledLinuxBin)) {
    try {
      fs.chmodSync(bundledLinuxBin, 0o755);
    } catch {}
    return bundledLinuxBin;
  }
  const defaultWinYtdlp =
    "C:\\Users\\Jaidev\\AppData\\Local\\Packages\\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\\LocalCache\\local-packages\\Python313\\Scripts\\yt-dlp.exe";
  if (process.platform === "win32" && fs.existsSync(defaultWinYtdlp)) {
    return defaultWinYtdlp;
  }
  return "yt-dlp";
}
const YTDLP = resolveYtdlp();

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

// Support subfolder mounting from cPanel / LiteSpeed (e.g. /yt-down)
app.use((req, res, next) => {
  if (req.url.startsWith("/yt-down")) {
    req.url = req.url.slice("/yt-down".length) || "/";
  }
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/yt-down", express.static(path.join(__dirname, "public")));

const jobs = new Map();

function safeName(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function saveJob(job) {
  if (!job || !job.folder) return;
  try {
    const metaPath = path.join(job.folder, "job.json");
    const data = {
      id: job.id,
      status: job.status,
      progress: job.progress,
      filename: job.filename,
      error: job.error,
      folder: job.folder,
      createdAt: job.createdAt,
    };
    fs.writeFileSync(metaPath, JSON.stringify(data), "utf8");
  } catch {}
}

function getJob(id) {
  const memJob = jobs.get(id);
  if (memJob) return memJob;
  const folder = path.join(DOWNLOAD_ROOT, id);
  const metaPath = path.join(folder, "job.json");
  if (fs.existsSync(metaPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      jobs.set(id, data);
      return data;
    } catch {}
  }
  return null;
}

function createJob() {
  const id =
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8);

  const folder = path.join(DOWNLOAD_ROOT, id);

  fs.mkdirSync(folder, { recursive: true });

  const job = {
    id,
    status: "starting",
    progress: 0,
    filename: null,
    error: null,
    process: null,
    folder,
    createdAt: Date.now(),
  };

  jobs.set(id, job);
  saveJob(job);

  return job;
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

app.get("/diag", (req, res) => {
  const pyCandidates = [
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/alt/python312/bin/python3",
    "/opt/alt/python311/bin/python3",
    "/opt/alt/python310/bin/python3",
  ];
  const pyResults = pyCandidates.map((p) => ({
    path: p,
    exists: fs.existsSync(p),
  }));

  const { execSync } = require("child_process");
  let ytdlpTest = "pending";
  try {
    ytdlpTest = execSync(`"${YTDLP}" --version`, {
      env: { ...process.env, TMPDIR: path.join(__dirname, "tmp") },
      encoding: "utf8",
      timeout: 5000,
    }).trim();
  } catch (err) {
    ytdlpTest = `error: ${err.message}`;
  }

  res.json({
    ok: true,
    platform: process.platform,
    YTDLP,
    ytdlpTest,
    pyResults,
  });
});

app.get("/setup-ffmpeg", (req, res) => {
  const { execSync } = require("child_process");
  try {
    const pyScript = `import urllib.request, tarfile, os, shutil
print("Downloading ffmpeg...")
urllib.request.urlretrieve("https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz", "f.tar.xz")
print("Extracting...")
with tarfile.open("f.tar.xz") as t:
    for m in t.getmembers():
        if m.name.endswith("/ffmpeg") or m.name.endswith("/ffprobe"):
            base = os.path.basename(m.name)
            f = t.extractfile(m)
            with open(base, "wb") as out:
                shutil.copyfileobj(f, out)
            os.chmod(base, 0o755)
os.remove("f.tar.xz")
print("Done!")
`;
    fs.writeFileSync(path.join(__dirname, "setup_ffmpeg.py"), pyScript);
    const output = execSync("/opt/alt/python312/bin/python3 setup_ffmpeg.py", {
      cwd: __dirname,
      encoding: "utf8",
      timeout: 180000,
    });
    try {
      fs.unlinkSync(path.join(__dirname, "setup_ffmpeg.py"));
    } catch {}
    res.json({
      ok: true,
      output,
      ffmpeg: fs.existsSync(path.join(__dirname, "ffmpeg")),
      ffprobe: fs.existsSync(path.join(__dirname, "ffprobe")),
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

app.post("/info", (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Please enter a YouTube URL." });
  }

  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)) {
    return res.status(400).json({ error: "Please enter a valid YouTube URL." });
  }

  const args = [
    "--dump-single-json",
    "--no-playlist",
    "--no-warnings",
    "--remote-components",
    "ejs:github",
    "--js-runtimes",
    "node",
    "--geo-bypass",
    "--geo-bypass-country",
    process.env.GEO_BYPASS_COUNTRY || "IN",
  ];

  if (process.env.YTDLP_PROXY || process.env.HTTP_PROXY) {
    args.push("--proxy", process.env.YTDLP_PROXY || process.env.HTTP_PROXY);
  }

  const cookiesPath =
    process.env.COOKIES_PATH || path.join(__dirname, "cookies.txt");
  if (fs.existsSync(cookiesPath)) {
    args.push("--cookies", cookiesPath);
  }

  args.push(url);

  const child = spawn(YTDLP, args, {
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      TMPDIR: path.join(__dirname, "tmp"),
      PATH: `/opt/alt/python312/bin:/opt/alt/python311/bin:${process.env.PATH || ""}`,
    },
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (data) => {
    stdout += data.toString();
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("close", (code) => {
    if (code !== 0 || !stdout.trim()) {
      return res.status(500).json({
        error: stderr.trim() || "Failed to fetch video information.",
      });
    }

    try {
      const data = JSON.parse(stdout);
      const heights = new Set();
      if (Array.isArray(data.formats)) {
        for (const f of data.formats) {
          if (typeof f.height === "number" && f.height > 0) {
            heights.add(f.height);
          }
        }
      }

      const standardMap = [
        { val: 2160, label: "2160p (4K Ultra HD)" },
        { val: 1440, label: "1440p (2K Quad HD)" },
        { val: 1080, label: "1080p (Full HD)" },
        { val: 720, label: "720p (HD)" },
        { val: 480, label: "480p (SD)" },
        { val: 360, label: "360p (Medium)" },
        { val: 240, label: "240p (Low)" },
        { val: 144, label: "144p (Data Saver)" },
      ];

      const maxHeight = Math.max(0, ...Array.from(heights));
      const videoQualities = standardMap
        .filter(
          (item) => heights.has(item.val) || (item.val <= maxHeight && item.val >= 360)
        )
        .map((item) => ({
          label: item.label,
          value: String(item.val),
          selected: item.val === Math.min(720, maxHeight),
        }));

      if (videoQualities.length === 0) {
        videoQualities.push(
          { label: "720p (HD)", value: "720", selected: true },
          { label: "480p (SD)", value: "480" },
          { label: "360p (Medium)", value: "360" }
        );
      }

      const audioQualities = [
        { label: "320 kbps (High Quality)", value: "320" },
        { label: "256 kbps (Very Good)", value: "256" },
        { label: "192 kbps (Standard)", value: "192", selected: true },
        { label: "128 kbps (Fast)", value: "128" },
      ];

      res.json({
        ok: true,
        title: data.title || "Unknown Title",
        thumbnail:
          data.thumbnail ||
          (data.thumbnails && data.thumbnails.length
            ? data.thumbnails[data.thumbnails.length - 1].url
            : null),
        duration:
          data.duration_string ||
          (data.duration
            ? `${Math.floor(data.duration / 60)}:${String(
                data.duration % 60
              ).padStart(2, "0")}`
            : null),
        channel: data.uploader || data.channel || "",
        videoQualities,
        audioQualities,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to parse video metadata." });
    }
  });

  child.on("error", (err) => {
    res.status(500).json({ error: err.message });
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

  const allowedMP3 = ["64", "128", "192", "256", "320"];
  const allowedMP4 = ["144", "240", "360", "480", "720", "1080", "1440", "2160"];

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
    "--remote-components",
    "ejs:github",
    "--js-runtimes",
    "node",
    "--geo-bypass",
    "--geo-bypass-country",
    process.env.GEO_BYPASS_COUNTRY || "IN",
  ];

  // Optional proxy support
  if (process.env.YTDLP_PROXY || process.env.HTTP_PROXY) {
    args.push("--proxy", process.env.YTDLP_PROXY || process.env.HTTP_PROXY);
  }

  // Check for bundled ffmpeg
  const bundledFfmpeg = path.join(__dirname, "ffmpeg");
  if (fs.existsSync(bundledFfmpeg)) {
    try {
      fs.chmodSync(bundledFfmpeg, 0o755);
    } catch {}
    args.push("--ffmpeg-location", bundledFfmpeg);
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
    env: {
      ...process.env,
      TMPDIR: path.join(__dirname, "tmp"),
      PATH: `/opt/alt/python312/bin:/opt/alt/python311/bin:${process.env.PATH || ""}`,
    },
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
    saveJob(job);
  });

  child.stderr.on("data", (data) => {
    stderr += data.toString();
  });

  child.on("error", (error) => {
    job.status = "error";
    job.error = error.message;
    job.process = null;
    saveJob(job);
  });

  child.on("close", (code) => {
    job.process = null;

    if (code !== 0) {
      job.status = "error";
      job.error =
        stderr.trim() ||
        `yt-dlp exited with code ${code}`;
      saveJob(job);
      return;
    }

    const file = findDownloadedFile(
      job.folder,
      selectedFormat
    );

    if (!file) {
      job.status = "error";
      job.error = "Download completed but output file was not found.";
      saveJob(job);
      return;
    }

    job.filename = file;
    job.progress = 100;
    job.status = "completed";
    saveJob(job);
  });

  res.json({
    success: true,
    jobId: job.id,
  });
});

app.get("/status/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);

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
        ? `${req.originalUrl && req.originalUrl.includes("/yt-down") ? "/yt-down" : ""}/download/${job.id}/${encodeURIComponent(
            job.filename
          )}`
        : null,
  });
});

app.post("/cancel/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);

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

  saveJob(job);

  res.json({
    success: true,
  });
});

app.get("/download/:jobId/:filename", (req, res) => {
  const job = getJob(req.params.jobId);

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
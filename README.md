# YouTube Downloader (Node.js + yt-dlp)

A lightweight, fast, and modern web application to download YouTube videos (MP4) and audio (MP3) powered by Express and `yt-dlp`.

---

## 🚀 Cloud Deployment Options

### Option 1: Deploy to Render (Recommended Free/Easy)
1. Push your code to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Deploy youtube downloader"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
2. Go to [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** -> **Web Service**.
4. Connect your GitHub repository.
5. Select **Docker** environment (Render will auto-detect the `Dockerfile` and `render.yaml`).
6. Click **Deploy Web Service**.

---

### Option 2: Deploy to Railway
1. Push your code to GitHub.
2. Go to [Railway](https://railway.app/).
3. Click **New Project** -> **Deploy from GitHub repo**.
4. Railway will automatically detect the `Dockerfile` and build it with `ffmpeg` and `yt-dlp`.
5. Under Settings > Networking, click **Generate Domain** to get your public URL.

---

### Option 3: Deploy to VPS / Cloud Server with Docker Compose
Run with a single command on any VPS (DigitalOcean, Hetzner, AWS, Linode):
```bash
docker compose up -d --build
```
Your app will be live at `http://<your-server-ip>:3000`.

---

## 💻 Local Development

1. Install dependencies:
   ```bash
   npm install
   ```
2. Ensure `yt-dlp` and `ffmpeg` are installed on your machine.
3. Start the server:
   ```bash
   npm start
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

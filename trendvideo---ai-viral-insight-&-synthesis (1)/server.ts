import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import axios from "axios";
import cors from "cors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Storage for generated videos and temporary assets
  const storageDir = path.join(__dirname, "storage");
  const videosDir = path.join(storageDir, "videos");
  const tempDir = path.join(storageDir, "temp");

  if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Endpoint to serve generated videos
  app.use("/videos", express.static(videosDir));

  // Video Synthesis Endpoint
  app.post("/api/synthesize", async (req, res) => {
    try {
      const { items, title } = req.body;
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "请选择至少一个热点条目进行合成" });
      }

      console.log(`Starting synthesis for ${items.length} items...`);
      const videoId = `video_${Date.now()}`;
      const outputPath = path.join(videosDir, `${videoId}.mp4`);
      
      // 1. Prepare assets (Download images)
      const processedItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const localImagePath = path.join(tempDir, `${videoId}_img_${i}.jpg`);
        
        try {
          const imageUrl = item.image && item.image.startsWith('http') 
            ? item.image 
            : `https://picsum.photos/seed/${encodeURIComponent(item.title)}/1080/1920`;
          
          const response = await axios({
            url: imageUrl,
            responseType: "stream",
            timeout: 15000,
            headers: {
              'User-Agent': 'Mozilla/5.0'
            }
          });

          const writer = fs.createWriteStream(localImagePath);
          response.data.pipe(writer);
          
          await new Promise<void>((resolve, reject) => {
            writer.on("finish", () => resolve());
            writer.on("error", (err) => reject(err));
          });

          // Check if file is actually written and not empty
          const stats = fs.statSync(localImagePath);
          if (stats.size > 0) {
            processedItems.push({ ...item, localImagePath });
          } else {
            console.warn(`Empty image downloaded for ${item.title}`);
            processedItems.push({ ...item, localImagePath: null });
          }
        } catch (err) {
          console.error(`Failed to download image: ${item.title}`, err instanceof Error ? err.message : err);
          processedItems.push({ ...item, localImagePath: null });
        }
      }

      const validItems = processedItems.filter(item => item.localImagePath && fs.existsSync(item.localImagePath));
      
      if (validItems.length === 0) {
        return res.status(400).json({ error: "素材下载失败：所有图片的链接均无效，请检查网络或更换关键词。" });
      }

      // 2. FFmpeg Synthesis
      console.log(`Starting stable synthesis for ${validItems.length} items...`);
      const command = ffmpeg();
      
      validItems.forEach(item => {
        command.input(item.localImagePath!).inputOptions(["-loop 1", "-t 5"]);
      });

      // Stable filter: High-speed scale and crop with strict normalization
      // Zoompan is replaced with a simpler, more stable scaling sequence to ensure compatibility
      const visualFilter = validItems.map((_, index) => {
        return `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=25[v${index}];`;
      }).join("");

      const concatFilter = validItems.map((_, index) => `[v${index}]`).join("") + `concat=n=${validItems.length}:v=1:a=0[outv];`;
      
      // Background audio: A slightly more complex and audible synthetic tone
      const audioFilter = `aevalsrc='0.1*sin(2*PI*t*440)*exp(-0.2*t)+0.02*noise(t)':d=${validItems.length * 5}[outa]`;

      command
        .complexFilter(visualFilter + concatFilter + audioFilter)
        .map("[outv]")
        .map("[outa]")
        .outputOptions([
          "-c:v libx264",
          "-pix_fmt yuv420p",
          "-r 25",
          "-preset ultrafast",
          "-c:a aac",
          "-b:a 64k",
          "-movflags +faststart",
          "-shortest"
        ])
        .on("start", (cmd) => console.log("FFmpeg started:", cmd))
        .on("stderr", (line) => {
          if (line.includes("Error") || line.includes("fail") || line.includes("Invalid")) {
            console.error("FFmpeg Log Error:", line);
          }
        })
        .on("error", (err, stdout, stderr) => {
          console.error("FFmpeg full error:", err.message);
          console.error("FFmpeg stderr output:", stderr);
          if (!res.headersSent) {
            res.status(500).json({ 
              error: "视频渲染系统响应超时或引擎错误", 
              message: err.message,
              debug: "建议减少选中的条目数量（建议 3-5 条）再次重试。" 
            });
          }
        })
        .on("end", () => {
          console.log("Synthesis complete:", outputPath);
          if (!res.headersSent) {
            res.json({ videoUrl: `/videos/${videoId}.mp4`, videoId });
          }
          
          // Delayed cleanup
          setTimeout(() => {
            validItems.forEach(item => {
              if (item.localImagePath && fs.existsSync(item.localImagePath)) {
                fs.unlink(item.localImagePath, () => {});
              }
            });
          }, 30000);
        })
        .save(outputPath);

    } catch (error) {
      console.error("Endpoint crash:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "服务器内部异常", detail: error instanceof Error ? error.message : "Unknown" });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();


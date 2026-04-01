import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API: Trigger GitHub Build
  app.post("/api/build", async (req, res) => {
    const { code, files } = req.body;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO; // e.g., "username/repo"

    if (!GITHUB_TOKEN || !GITHUB_REPO || GITHUB_TOKEN === "YOUR_GITHUB_TOKEN") {
      return res.status(500).json({ error: "GitHub configuration missing in .env" });
    }

    try {
      // In a real scenario, we would push the code to a branch.
      // For this demo, we'll trigger a 'repository_dispatch' event
      // which GitHub Actions can listen to.
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/dispatches`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: "build_apk",
          client_payload: {
            code: code || "No code provided",
            timestamp: new Date().toISOString()
          }
        })
      });

      if (response.ok) {
        res.json({ message: "Build triggered successfully on GitHub!", status: "queued" });
      } else {
        const errorData = await response.json();
        res.status(response.status).json({ error: errorData.message || "Failed to trigger build" });
      }
    } catch (error) {
      console.error("GitHub API Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // API: Check Build Status (Mocked for now, would normally poll GitHub Runs API)
  app.get("/api/build/status", async (req, res) => {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO;

    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/runs?event=repository_dispatch&per_page=1`, {
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
        }
      });
      const data = await response.json();
      const latestRun = data.workflow_runs?.[0];

      if (latestRun) {
        res.json({
          status: latestRun.status, // queued, in_progress, completed
          conclusion: latestRun.conclusion, // success, failure, cancelled
          url: latestRun.html_url
        });
      } else {
        res.json({ status: "not_found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch status" });
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
    console.log(`Kaabool Server running on http://localhost:${PORT}`);
  });
}

startServer();

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

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API: Trigger GitHub Build
  app.post("/api/build", async (req, res) => {
    const { code, files, metadata } = req.body;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO; // e.g., "username/repo"

    if (!GITHUB_TOKEN || !GITHUB_REPO || GITHUB_TOKEN === "YOUR_GITHUB_TOKEN") {
      return res.status(500).json({ error: "GitHub configuration missing in .env" });
    }

    try {
      // 1. Create Blobs for files
      const createBlob = async (content: string) => {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/blobs`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${GITHUB_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            content: Buffer.from(content).toString('base64'),
            encoding: 'base64'
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(`Blob creation failed: ${JSON.stringify(data)}`);
        return data.sha;
      };

      const appJsSha = await createBlob(code || "// No code provided");
      const metadataSha = await createBlob(JSON.stringify(metadata || {}, null, 2));

      // 2. Get current branch ref
      const refRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, {
        headers: { "Authorization": `Bearer ${GITHUB_TOKEN}` }
      });
      const refData = await refRes.json();
      const latestCommitSha = refData.object.sha;

      // 3. Get latest commit tree
      const commitRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/commits/${latestCommitSha}`, {
        headers: { "Authorization": `Bearer ${GITHUB_TOKEN}` }
      });
      const commitData = await commitRes.json();
      const baseTreeSha = commitData.tree.sha;

      // 4. Create new tree with multiple files using blob SHAs
      const treeRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/trees`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [
            { path: 'App.js', mode: '100644', type: 'blob', sha: appJsSha },
            { path: 'kaabool-metadata.json', mode: '100644', type: 'blob', sha: metadataSha }
          ]
        })
      });
      const treeData = await treeRes.json();

      // 5. Create commit
      const newCommitRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/commits`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `Build: ${metadata?.name || 'App'} v${metadata?.version || '1.0.0'}`,
          tree: treeData.sha,
          parents: [latestCommitSha]
        })
      });
      const newCommitData = await newCommitRes.json();

      // 6. Update ref
      const updateRefRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/git/refs/heads/main`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sha: newCommitData.sha })
      });

      if (updateRefRes.ok) {
        res.json({ message: "Build triggered successfully!", status: "queued", sha: newCommitData.sha });
      } else {
        res.status(500).json({ error: "Failed to update GitHub branch" });
      }
    } catch (error) {
      console.error("GitHub API Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // API: Check Build Status
  app.get("/api/build/status", async (req, res) => {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO;
    const { sha } = req.query;

    try {
      let url = `https://api.github.com/repos/${GITHUB_REPO}/actions/runs?event=push&per_page=1`;
      if (sha) {
        url = `https://api.github.com/repos/${GITHUB_REPO}/actions/runs?head_sha=${sha}&per_page=1`;
      }

      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
        }
      });
      const data = await response.json();
      const latestRun = data.workflow_runs?.[0];

      if (latestRun) {
        let artifactId = null;
        if (latestRun.status === 'completed' && latestRun.conclusion === 'success') {
          const artifactsRes = await fetch(latestRun.artifacts_url, {
            headers: { "Authorization": `Bearer ${GITHUB_TOKEN}` }
          });
          const artifactsData = await artifactsRes.json();
          if (artifactsData.artifacts && artifactsData.artifacts.length > 0) {
            artifactId = artifactsData.artifacts[0].id;
          }
        }

        res.json({
          status: latestRun.status,
          conclusion: latestRun.conclusion,
          url: latestRun.html_url,
          artifactId: artifactId
        });
      } else {
        res.json({ status: "not_found" });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });

  // API: Proxy Download Artifact
  app.get("/api/download/:artifactId", async (req, res) => {
    const { artifactId } = req.params;
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
    const GITHUB_REPO = process.env.GITHUB_REPO;

    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/artifacts/${artifactId}/zip`, {
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github+json",
        },
        redirect: 'manual'
      });

      const downloadUrl = response.headers.get('location');
      if (downloadUrl) {
        res.redirect(downloadUrl);
      } else {
        res.status(404).send("Download URL not found");
      }
    } catch (error) {
      res.status(500).send("Error fetching download link");
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

  // Global Error Handler to prevent HTML error pages
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Server Error:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal Server Error",
      code: err.code
    });
  });
}

startServer();

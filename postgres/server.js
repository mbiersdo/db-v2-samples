import express from "express";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: "postgresql://postgres:mysecretpassword@localhost:5432",
});

async function init() {
  const app = express();

  app.get("/get", async (req, res) => {
    try {
      const client = await pool.connect();
      const [commentsRes, boardRes] = await Promise.all([
        client.query("SELECT * FROM comments NATURAL LEFT JOIN rich_content WHERE board_id = $1", [req.query.search]),
        client.query("SELECT * FROM boards WHERE board_id = $1", [req.query.search]),
      ]);
      res
        .json({
          status: "ok",
          board: boardRes.rows[0] || {},
          posts: commentsRes.rows,
        })
        .end();
      client.release();
    } catch (err) {
      console.error(err);
    }
  });

  const PORT = process.env.PORT || 3000;
  app.use(express.static("./static"));
  app.listen(PORT);

  console.log(`running on http://localhost:${PORT}`);
}
init();

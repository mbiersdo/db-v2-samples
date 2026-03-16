import pg from "pg";

const CONNECTION_STRING =
  "postgresql://postgres:mysecretpassword@localhost:5432";

const PROVIDERS = {
  openai: {
    dimensions: 1536,
    model: "text-embedding-3-small",
    async embed(texts) {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: texts,
          model: "text-embedding-3-small",
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`OpenAI API error: ${res.status} ${err}`);
      }

      const data = await res.json();
      return data.data.map((d) => d.embedding);
    },
  },

  ollama: {
    dimensions: 768,
    model: "nomic-embed-text",
    async embed(texts) {
      const res = await fetch("http://localhost:11434/api/embed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "nomic-embed-text",
          input: texts,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Ollama API error: ${res.status} ${err}`);
      }

      const data = await res.json();
      return data.embeddings;
    },
  },
};

const [mode, providerName, ...rest] = process.argv.slice(2);

if (!PROVIDERS[providerName] || !["generate", "get"].includes(mode)) {
  console.error("Usage:");
  console.error(
    "  node embeddings.js generate <openai|ollama>     Embed all comments",
  );
  console.error(
    '  node embeddings.js get <openai|ollama> "text"    Get a single embedding',
  );
  process.exit(1);
}

const provider = PROVIDERS[providerName];

if (mode === "get") {
  const text = rest.join(" ");
  if (!text) {
    console.error(
      'Provide text to embed: node embeddings.js get ollama "your text here"',
    );
    process.exit(1);
  }

  const [embedding] = await provider.embed([text]);
  console.log(`[${embedding.join(",")}]`);
} else {
  console.log(
    `Using ${providerName} (${provider.model}, ${provider.dimensions} dimensions)`,
  );

  const client = new pg.Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  await client.query("CREATE EXTENSION IF NOT EXISTS vector");

  // Drop and recreate column to match provider dimensions
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'comments' AND column_name = 'embedding'
      ) THEN
        ALTER TABLE comments DROP COLUMN embedding;
      END IF;
    END $$
  `);
  await client.query(
    `ALTER TABLE comments ADD COLUMN embedding vector(${provider.dimensions})`,
  );

  const { rows } = await client.query(
    "SELECT comment_id, comment FROM comments ORDER BY comment_id",
  );
  console.log(`Found ${rows.length} comments to embed`);

  const BATCH_SIZE = 50;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const texts = batch.map((r) => r.comment);
    const embeddings = await provider.embed(texts);

    for (let j = 0; j < batch.length; j++) {
      const vectorStr = `[${embeddings[j].join(",")}]`;
      await client.query(
        "UPDATE comments SET embedding = $1 WHERE comment_id = $2",
        [vectorStr, batch[j].comment_id],
      );
    }

    console.log(
      `Embedded ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`,
    );
  }

  console.log("Done!");
  await client.end();
}

import express from "express";
import redis from "redis";
const client = redis.createClient();

function cache(key, ttl, slowFn) {
  return async function (...props) {
    const cachedResponse = await client.get(key);
    if (cachedResponse) {
      return cachedResponse;
    }
    const result = await slowFn(...props);
    await client.setEx(key, ttl, result);
    return result;
  };
}

async function verySlowAndExpensiveFunction() {
  // imagine this is like a really big join on PostgreSQL
  // or a call to an expensive API

  console.log("oh no an expensive call!");
  const p = new Promise((resolve) => {
    setTimeout(() => {
      resolve(new Date().toUTCString());
    }, 5000);
  });

  return p;
}

const cachedFn = cache("expensive_call", 10, verySlowAndExpensiveFunction);

async function init() {
  await client.connect();
  const app = express();

  app.get("/pageview", async (req, res) => {
    const views = await client.incr("pageviews");

    res.json({
      status: "ok",
      views,
    });
  });

  // inside init, under app.get pageviews
  app.get("/get", async (req, res) => {
    const data = await cachedFn();

    res.json({
      data,
      status: "ok",
    });
  });

  const PORT = process.env.PORT || 3000;
  app.use(express.static("./static"));
  app.listen(PORT);

  console.log(`running on http://localhost:${PORT}`);
}
init();

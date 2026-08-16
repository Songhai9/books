import express from "express";
import { db } from "./db.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("index.ejs", {
    pageTitle: "Book Notes",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "book-notes",
  });
});

app.get("/ready", async (req, res) => {
  try {
    await db.query("SELECT 1");

    res.status(200).json({
      status: "ready",
      database: "connected",
    });
  } catch (error) {
    console.error("PostgreSQL readiness check failed:", error.message);

    res.status(503).json({
      status: "not ready",
      database: "unavailable",
    });
  }
});

app.use((req, res) => {
  res.status(404).render("error.ejs", {
    pageTitle: "Page not found",
    statusCode: 404,
    message: "The page you requested does not exist.",
  });
});

app.use((error, req, res, next) => {
  console.error("Unexpected application error:", error);

  res.status(500).render("error.ejs", {
    pageTitle: "Application error",
    statusCode: 500,
    message: "Something went wrong. Please try again.",
  });
});

app.listen(port, (error) => {
  if (error) {
    console.error("Book Notes failed to start:", error.message);
    process.exitCode = 1;
    return;
  }

  console.log(`Book Notes is running on http://localhost:${port}`);
});
